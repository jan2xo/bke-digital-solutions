import "server-only";
import { createHmac } from "node:crypto";
import {
  ACCOUNTS_CUSTOMER_LIFECYCLE_TRANSITION_POLICY_CAPABILITY_ID,
  type AccountsCustomerLifecyclePolicyErrorCode,
  type AccountsCustomerLifecyclePolicyResult,
  type AccountsCustomerLifecycleTransitionPolicyCapability,
} from "@bke/accounts/contracts/customer-lifecycle-transition-policy.contract";
import {
  ACCOUNTS_CUSTOMER_RETENTION_POLICY_CAPABILITY_ID,
  type AccountsCustomerRetentionPolicyCapability,
} from "@bke/accounts/contracts/customer-retention-policy.contract";
import { planPrivacyCustomerMinimization } from "@bke/privacy/logic/customer-minimization";
import { Prisma } from "@/v2/platform/persistence/generated/prisma/client";
import { db } from "@/v2/platform/host/db";
import { env } from "@/v2/platform/host/env";
import { getV2WebApplication } from "@/v2/apps/web/runtime";

export type CustomerLifecycleErrorCode =
  | "NOT_FOUND"
  | AccountsCustomerLifecyclePolicyErrorCode
  | "ACTIVE_SUBSCRIPTION_BLOCKS_PURGE"
  | "PAYMENT_HISTORY_BLOCKS_PURGE"
  | "UNRESOLVED_DISPUTE_BLOCKS_PURGE";

export class CustomerLifecycleError extends Error {
  constructor(
    public readonly code: CustomerLifecycleErrorCode,
    public readonly blockers: string[] = [],
  ) {
    super(code);
  }
}

export type RetentionBlockerReport = {
  userId: string;
  counts: Record<string, number>;
  blockers: string[];
  canPseudonymize: boolean;
  canMarkPurgeEligible: boolean;
  canPurge: boolean;
};

async function customerLifecycleCapabilities() {
  const application = await getV2WebApplication();
  return {
    retentionPolicy: application.get<AccountsCustomerRetentionPolicyCapability>(
      ACCOUNTS_CUSTOMER_RETENTION_POLICY_CAPABILITY_ID,
    ),
    lifecyclePolicy: application.get<AccountsCustomerLifecycleTransitionPolicyCapability>(
      ACCOUNTS_CUSTOMER_LIFECYCLE_TRANSITION_POLICY_CAPABILITY_ID,
    ),
  };
}

function requireLifecycleDecision<T>(result: AccountsCustomerLifecyclePolicyResult<T>): T {
  if (result.status === "FAILED") {
    throw new CustomerLifecycleError(result.code, [...(result.blockers ?? [])]);
  }
  return result.value;
}

export async function customerRetentionBlockers(userId: string): Promise<RetentionBlockerReport> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      legalHoldAt: true,
      retentionExpiresAt: true,
      pseudonymizedAt: true,
      _count: { select: { legalAcceptances: true, memberships: true, assignments: true } },
      ownedAccounts: {
        select: {
          id: true,
          type: true,
          legalHoldAt: true,
          retentionExpiresAt: true,
          _count: {
            select: {
              orders: true,
              licenses: true,
              subscriptions: true,
              trials: true,
              legalAcceptances: true,
            },
          },
          subscriptions: {
            where: { status: { in: ["ACTIVE", "PAST_DUE", "PENDING"] } },
            select: { id: true },
          },
          orders: {
            where: {
              OR: [
                { status: "PENDING" },
                {
                  payments: {
                    some: { status: { in: ["PENDING", "PAID", "PARTIALLY_REFUNDED"] } },
                  },
                },
              ],
            },
            select: { id: true },
          },
        },
      },
    },
  });
  if (!user) throw new CustomerLifecycleError("NOT_FOUND");

  const now = new Date();
  const counts = {
    ownedAccounts: user.ownedAccounts.length,
    organizationAccounts: user.ownedAccounts.filter((account) => account.type === "ORGANIZATION").length,
    memberships: user._count.memberships,
    licenseAssignments: user._count.assignments,
    orders: user.ownedAccounts.reduce((count, account) => count + account._count.orders, 0),
    licenses: user.ownedAccounts.reduce((count, account) => count + account._count.licenses, 0),
    subscriptions: user.ownedAccounts.reduce(
      (count, account) => count + account._count.subscriptions,
      0,
    ),
    trials: user.ownedAccounts.reduce((count, account) => count + account._count.trials, 0),
    legalAcceptances:
      user._count.legalAcceptances +
      user.ownedAccounts.reduce((count, account) => count + account._count.legalAcceptances, 0),
    activeSubscriptions: user.ownedAccounts.reduce(
      (count, account) => count + account.subscriptions.length,
      0,
    ),
    unresolvedPayments: user.ownedAccounts.reduce(
      (count, account) => count + account.orders.length,
      0,
    ),
  };
  const legalHold = Boolean(
    user.legalHoldAt || user.ownedAccounts.some((account) => account.legalHoldAt),
  );
  const retentionActive = [
    user.retentionExpiresAt,
    ...user.ownedAccounts.map((account) => account.retentionExpiresAt),
  ].some((date) => Boolean(date && date > now));

  const { retentionPolicy } = await customerLifecycleCapabilities();
  const result = retentionPolicy.evaluate({
    userId: user.id,
    administratorProtected: user.role === "ADMIN",
    organizationAccounts: counts.organizationAccounts,
    memberships: counts.memberships,
    licenseAssignments: counts.licenseAssignments,
    orders: counts.orders,
    licenses: counts.licenses,
    subscriptions: counts.subscriptions,
    trials: counts.trials,
    legalAcceptances: counts.legalAcceptances,
    activeSubscriptions: counts.activeSubscriptions,
    unresolvedPayments: counts.unresolvedPayments,
    legalHold,
    retentionActive,
    pseudonymized: Boolean(user.pseudonymizedAt),
  });
  if (result.status === "FAILED") throw new Error(result.code);

  return {
    userId: result.value.userId,
    counts,
    blockers: [...result.value.blockers],
    canPseudonymize: result.value.canPseudonymize,
    canMarkPurgeEligible: result.value.canMarkPurgeEligible,
    canPurge: result.value.canPurge,
  };
}

export async function closeCustomer(input: { userId: string; actorId: string }) {
  const { lifecyclePolicy } = await customerLifecycleCapabilities();
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        include: { ownedAccounts: true },
      });
      if (!user) throw new CustomerLifecycleError("NOT_FOUND");

      requireLifecycleDecision(
        lifecyclePolicy.close({
          userId: user.id,
          actorId: input.actorId,
          administratorProtected: user.role === "ADMIN",
          lifecycleState: user.lifecycleState,
          organizationAccounts: user.ownedAccounts.filter(
            (account) => account.type === "ORGANIZATION",
          ).length,
        }),
      );

      const now = new Date();
      const accountIds = user.ownedAccounts.map((account) => account.id);
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.user.update({
        where: { id: user.id },
        data: { lifecycleState: "CLOSED", suspendedAt: now },
      });
      if (accountIds.length) {
        await tx.customerAccount.updateMany({
          where: { id: { in: accountIds } },
          data: { lifecycleState: "CLOSED", closureRequestedAt: now, closedAt: now },
        });
        await tx.subscription.updateMany({
          where: {
            accountId: { in: accountIds },
            status: { in: ["ACTIVE", "PAST_DUE", "PENDING"] },
          },
          data: { status: "CANCELLED" },
        });
        await tx.license.updateMany({
          where: { accountId: { in: accountIds }, status: "ACTIVE" },
          data: { status: "SUSPENDED" },
        });
        await tx.deviceActivation.updateMany({
          where: { license: { accountId: { in: accountIds } }, active: true },
          data: { active: false, deactivatedAt: now },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "CUSTOMER_ACCOUNT_CLOSED",
          targetType: "User",
          targetId: user.id,
          metadata: { accountCount: accountIds.length },
        },
      });
      return { accountCount: accountIds.length };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function reopenCustomer(input: { userId: string; actorId: string }) {
  const { lifecyclePolicy } = await customerLifecycleCapabilities();
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      include: { ownedAccounts: { select: { id: true, type: true } } },
    });
    if (!user) throw new CustomerLifecycleError("NOT_FOUND");

    requireLifecycleDecision(
      lifecyclePolicy.reopen({
        administratorProtected: user.role === "ADMIN",
        lifecycleState: user.lifecycleState,
        pseudonymized: Boolean(user.pseudonymizedAt),
        legalHold: Boolean(user.legalHoldAt),
      }),
    );

    const ids = user.ownedAccounts
      .filter((account) => account.type === "INDIVIDUAL")
      .map((account) => account.id);
    await tx.user.update({
      where: { id: user.id },
      data: { lifecycleState: "ACTIVE", suspendedAt: null },
    });
    await tx.customerAccount.updateMany({
      where: { id: { in: ids }, lifecycleState: "CLOSED" },
      data: { lifecycleState: "ACTIVE", closedAt: null },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "CUSTOMER_ACCOUNT_REOPENED",
        targetType: "User",
        targetId: user.id,
        metadata: { accountCount: ids.length, entitlementsRemainSuspended: true },
      },
    });
  });
}

export async function requestPrivacyDeletion(input: {
  userId: string;
  actorId: string;
  retentionExpiresAt: Date;
}) {
  const { lifecyclePolicy } = await customerLifecycleCapabilities();
  const now = new Date();

  requireLifecycleDecision(
    lifecyclePolicy.requestPrivacyDeletion({
      administratorProtected: false,
      legalHold: false,
      retentionExpiresAt: input.retentionExpiresAt,
      now,
    }),
  );

  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { role: true, legalHoldAt: true, ownedAccounts: { select: { id: true } } },
  });
  if (!user) throw new CustomerLifecycleError("NOT_FOUND");

  requireLifecycleDecision(
    lifecyclePolicy.requestPrivacyDeletion({
      administratorProtected: user.role === "ADMIN",
      legalHold: Boolean(user.legalHoldAt),
      retentionExpiresAt: input.retentionExpiresAt,
      now,
    }),
  );

  await db.$transaction([
    db.session.deleteMany({ where: { userId: input.userId } }),
    db.user.update({
      where: { id: input.userId },
      data: {
        lifecycleState: "PRIVACY_REVIEW",
        privacyRequestedAt: now,
        retentionExpiresAt: input.retentionExpiresAt,
        suspendedAt: now,
      },
    }),
    db.customerAccount.updateMany({
      where: { id: { in: user.ownedAccounts.map((account) => account.id) } },
      data: {
        lifecycleState: "PRIVACY_REVIEW",
        privacyRequestedAt: now,
        retentionExpiresAt: input.retentionExpiresAt,
      },
    }),
    db.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "PRIVACY_DELETION_REQUESTED",
        targetType: "User",
        targetId: input.userId,
        metadata: { retentionConfigured: true },
      },
    }),
  ]);
}

export async function setLegalHold(input: {
  userId: string;
  actorId: string;
  enabled: boolean;
  reason?: string;
}) {
  const { lifecyclePolicy } = await customerLifecycleCapabilities();
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { role: true, ownedAccounts: { select: { id: true } } },
  });
  if (!user) throw new CustomerLifecycleError("NOT_FOUND");

  const hold = requireLifecycleDecision(
    lifecyclePolicy.legalHold({
      administratorProtected: user.role === "ADMIN",
      enabled: input.enabled,
      reason: input.reason,
      now: new Date(),
    }),
  );

  await db.$transaction([
    db.user.update({
      where: { id: input.userId },
      data: { legalHoldAt: hold.legalHoldAt, legalHoldReason: hold.legalHoldReason },
    }),
    db.customerAccount.updateMany({
      where: { id: { in: user.ownedAccounts.map((account) => account.id) } },
      data: { legalHoldAt: hold.legalHoldAt, legalHoldReason: hold.legalHoldReason },
    }),
    db.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.enabled ? "LEGAL_HOLD_APPLIED" : "LEGAL_HOLD_REMOVED",
        targetType: "User",
        targetId: input.userId,
        metadata: { reasonCode: input.enabled ? "ADMINISTRATIVE" : "RELEASED" },
      },
    }),
  ]);
}

export async function pseudonymizeCustomer(input: { userId: string; actorId: string }) {
  const report = await customerRetentionBlockers(input.userId);
  const { lifecyclePolicy } = await customerLifecycleCapabilities();

  return db.$transaction(
    async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: input.userId },
        include: { ownedAccounts: { select: { id: true } } },
      });
      requireLifecycleDecision(
        lifecyclePolicy.pseudonymize({
          lifecycleState: user.lifecycleState,
          canPseudonymize: report.canPseudonymize,
          blockers: report.blockers,
        }),
      );

      const now = new Date();
      const plan = planPrivacyCustomerMinimization({
        userId: user.id,
        email: user.email,
        now,
      });
      const emailHash = createHmac("sha256", env.SESSION_SECRET)
        .update(plan.normalizedEmailHashSource)
        .digest("hex");

      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.passwordCredential.deleteMany({ where: { userId: user.id } });
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await tx.verificationToken.deleteMany({ where: { identifier: user.email } });
      await tx.emailOutbox.updateMany({
        where: { recipient: user.email },
        data: {
          recipient: plan.emailOutboxUpdate.recipient,
          payload: { ...plan.emailOutboxUpdate.payload },
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { ...plan.userUpdate, emailHash },
      });
      await tx.customerAccount.updateMany({
        where: { id: { in: user.ownedAccounts.map((account) => account.id) } },
        data: { ...plan.customerAccountUpdate },
      });
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: plan.audit.action,
          targetType: plan.audit.targetType,
          targetId: user.id,
          metadata: { ...plan.audit.metadata },
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function markPurgeEligible(input: { userId: string; actorId: string }) {
  const report = await customerRetentionBlockers(input.userId);
  const { lifecyclePolicy } = await customerLifecycleCapabilities();
  requireLifecycleDecision(
    lifecyclePolicy.markPurgeEligible({
      canMarkPurgeEligible: report.canMarkPurgeEligible,
      blockers: report.blockers,
    }),
  );

  await db.$transaction([
    db.user.update({
      where: { id: input.userId },
      data: { lifecycleState: "PURGE_ELIGIBLE" },
    }),
    db.customerAccount.updateMany({
      where: { ownerId: input.userId },
      data: { lifecycleState: "PURGE_ELIGIBLE" },
    }),
    db.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "CUSTOMER_MARKED_PURGE_ELIGIBLE",
        targetType: "User",
        targetId: input.userId,
        metadata: { blockerCount: report.blockers.length },
      },
    }),
  ]);
}

export async function executeFinalPurge(input: {
  userId: string;
  actorId: string;
  confirmation: string;
}) {
  const { lifecyclePolicy } = await customerLifecycleCapabilities();

  requireLifecycleDecision(
    lifecyclePolicy.finalPurge({
      userId: input.userId,
      confirmation: input.confirmation,
      lifecycleState: "PURGE_ELIGIBLE",
      canPurge: true,
      blockers: [],
    }),
  );

  const report = await customerRetentionBlockers(input.userId);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: input.userId },
        include: { ownedAccounts: { select: { id: true } } },
      });
      requireLifecycleDecision(
        lifecyclePolicy.finalPurge({
          userId: input.userId,
          confirmation: input.confirmation,
          lifecycleState: user.lifecycleState,
          canPurge: report.canPurge,
          blockers: report.blockers,
        }),
      );

      const accountIds = user.ownedAccounts.map((account) => account.id);
      await tx.cart.deleteMany({ where: { accountId: { in: accountIds } } });
      await tx.invitation.deleteMany({ where: { accountId: { in: accountIds } } });
      await tx.customerAccount.deleteMany({ where: { id: { in: accountIds } } });
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await tx.user.delete({ where: { id: user.id } });
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "CUSTOMER_FINAL_PURGE_EXECUTED",
          targetType: "PurgedUser",
          targetId: input.userId,
          metadata: { integrityVerified: true },
        },
      });
      return { purged: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

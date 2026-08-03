import "server-only";
import { createHmac } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export type CustomerLifecycleErrorCode =
  | "NOT_FOUND" | "FORBIDDEN" | "CUSTOMER_CLOSURE_BLOCKED" | "CUSTOMER_ALREADY_CLOSED"
  | "PRIVACY_DELETION_BLOCKED" | "LEGAL_HOLD_ACTIVE" | "RETENTION_PERIOD_ACTIVE"
  | "PURGE_NOT_ELIGIBLE" | "PURGE_CONFIRMATION_REQUIRED" | "ACTIVE_SUBSCRIPTION_BLOCKS_PURGE"
  | "PAYMENT_HISTORY_BLOCKS_PURGE" | "UNRESOLVED_DISPUTE_BLOCKS_PURGE";

export class CustomerLifecycleError extends Error {
  constructor(public readonly code: CustomerLifecycleErrorCode, public readonly blockers: string[] = []) { super(code); }
}

export type RetentionBlockerReport = {
  userId: string;
  counts: Record<string, number>;
  blockers: string[];
  canPseudonymize: boolean;
  canMarkPurgeEligible: boolean;
  canPurge: boolean;
};

const hashEmail = (email: string) => createHmac("sha256", env.SESSION_SECRET).update(email.trim().toLowerCase()).digest("hex");
const pseudonymousEmail = (id: string) => `removed+${id}@privacy.invalid`;

export async function customerRetentionBlockers(userId: string): Promise<RetentionBlockerReport> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, role: true, lifecycleState: true, legalHoldAt: true, retentionExpiresAt: true, pseudonymizedAt: true,
      _count: { select: { legalAcceptances: true, memberships: true, assignments: true } },
      ownedAccounts: { select: {
        id: true, type: true, legalHoldAt: true, retentionExpiresAt: true,
        _count: { select: { orders: true, licenses: true, subscriptions: true, trials: true, legalAcceptances: true } },
        subscriptions: { where: { status: { in: ["ACTIVE", "PAST_DUE", "PENDING"] } }, select: { id: true } },
        orders: { where: { OR: [{ status: "PENDING" }, { payments: { some: { status: { in: ["PENDING", "PAID", "PARTIALLY_REFUNDED"] } } } }] }, select: { id: true } },
      } },
    },
  });
  if (!user) throw new CustomerLifecycleError("NOT_FOUND");
  const now = new Date();
  const counts = {
    ownedAccounts: user.ownedAccounts.length,
    organizationAccounts: user.ownedAccounts.filter((account) => account.type === "ORGANIZATION").length,
    memberships: user._count.memberships,
    licenseAssignments: user._count.assignments,
    orders: user.ownedAccounts.reduce((n, account) => n + account._count.orders, 0),
    licenses: user.ownedAccounts.reduce((n, account) => n + account._count.licenses, 0),
    subscriptions: user.ownedAccounts.reduce((n, account) => n + account._count.subscriptions, 0),
    trials: user.ownedAccounts.reduce((n, account) => n + account._count.trials, 0),
    legalAcceptances: user._count.legalAcceptances + user.ownedAccounts.reduce((n, account) => n + account._count.legalAcceptances, 0),
    activeSubscriptions: user.ownedAccounts.reduce((n, account) => n + account.subscriptions.length, 0),
    unresolvedPayments: user.ownedAccounts.reduce((n, account) => n + account.orders.length, 0),
  };
  const legalHold = Boolean(user.legalHoldAt || user.ownedAccounts.some((account) => account.legalHoldAt));
  const retentionActive = [user.retentionExpiresAt, ...user.ownedAccounts.map((account) => account.retentionExpiresAt)].some((date) => date && date > now);
  const blockers: string[] = [];
  if (user.role === "ADMIN") blockers.push("ADMINISTRATOR_PROTECTED");
  if (counts.organizationAccounts) blockers.push("ORGANIZATION_OWNER_TRANSFER_REQUIRED");
  if (counts.activeSubscriptions) blockers.push("ACTIVE_SUBSCRIPTION");
  if (counts.unresolvedPayments) blockers.push("UNRESOLVED_PAYMENT_OR_REFUND");
  if (legalHold) blockers.push("LEGAL_HOLD");
  if (retentionActive) blockers.push("RETENTION_PERIOD_ACTIVE");
  if (counts.legalAcceptances) blockers.push("IMMUTABLE_LEGAL_ACCEPTANCE");
  if (counts.orders || counts.licenses || counts.subscriptions || counts.trials) blockers.push("PRESERVED_COMMERCIAL_HISTORY");
  if (counts.memberships) blockers.push("UNRELATED_ACCOUNT_MEMBERSHIP");
  if (counts.licenseAssignments) blockers.push("LICENSE_ASSIGNMENT_REMAINS");
  return {
    userId,
    counts,
    blockers,
    canPseudonymize: user.role !== "ADMIN" && !legalHold,
    canMarkPurgeEligible: Boolean(user.pseudonymizedAt) && !legalHold && !retentionActive,
    canPurge: Boolean(user.pseudonymizedAt) && blockers.length === 0,
  };
}

export async function closeCustomer(input: { userId: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: input.userId }, include: { ownedAccounts: true } });
    if (!user) throw new CustomerLifecycleError("NOT_FOUND");
    if (user.role === "ADMIN" || user.id === input.actorId) throw new CustomerLifecycleError("FORBIDDEN");
    if (["CLOSED", "PRIVACY_REVIEW", "PSEUDONYMIZED", "PURGE_ELIGIBLE"].includes(user.lifecycleState)) throw new CustomerLifecycleError("CUSTOMER_ALREADY_CLOSED");
    if (user.ownedAccounts.some((account) => account.type === "ORGANIZATION")) throw new CustomerLifecycleError("CUSTOMER_CLOSURE_BLOCKED", ["ORGANIZATION_OWNER_TRANSFER_REQUIRED"]);
    const now = new Date();
    const accountIds = user.ownedAccounts.map((account) => account.id);
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.user.update({ where: { id: user.id }, data: { lifecycleState: "CLOSED", suspendedAt: now } });
    if (accountIds.length) {
      await tx.customerAccount.updateMany({ where: { id: { in: accountIds } }, data: { lifecycleState: "CLOSED", closureRequestedAt: now, closedAt: now } });
      await tx.subscription.updateMany({ where: { accountId: { in: accountIds }, status: { in: ["ACTIVE", "PAST_DUE", "PENDING"] } }, data: { status: "CANCELLED" } });
      await tx.license.updateMany({ where: { accountId: { in: accountIds }, status: "ACTIVE" }, data: { status: "SUSPENDED" } });
      await tx.deviceActivation.updateMany({ where: { license: { accountId: { in: accountIds } }, active: true }, data: { active: false, deactivatedAt: now } });
    }
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "CUSTOMER_ACCOUNT_CLOSED", targetType: "User", targetId: user.id, metadata: { accountCount: accountIds.length } } });
    return { accountCount: accountIds.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reopenCustomer(input: { userId: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId }, include: { ownedAccounts: { select: { id: true, type: true } } } });
    if (!user) throw new CustomerLifecycleError("NOT_FOUND");
    if (user.role === "ADMIN" || user.lifecycleState !== "CLOSED" || user.pseudonymizedAt || user.legalHoldAt) throw new CustomerLifecycleError("FORBIDDEN");
    const ids = user.ownedAccounts.filter((account) => account.type === "INDIVIDUAL").map((account) => account.id);
    await tx.user.update({ where: { id: user.id }, data: { lifecycleState: "ACTIVE", suspendedAt: null } });
    await tx.customerAccount.updateMany({ where: { id: { in: ids }, lifecycleState: "CLOSED" }, data: { lifecycleState: "ACTIVE", closedAt: null } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "CUSTOMER_ACCOUNT_REOPENED", targetType: "User", targetId: user.id, metadata: { accountCount: ids.length, entitlementsRemainSuspended: true } } });
  });
}

export async function requestPrivacyDeletion(input: { userId: string; actorId: string; retentionExpiresAt: Date }) {
  if (input.retentionExpiresAt <= new Date()) throw new CustomerLifecycleError("RETENTION_PERIOD_ACTIVE", ["RETENTION_DATE_MUST_BE_FUTURE"]);
  const user = await db.user.findUnique({ where: { id: input.userId }, select: { role: true, legalHoldAt: true, ownedAccounts: { select: { id: true } } } });
  if (!user) throw new CustomerLifecycleError("NOT_FOUND");
  if (user.role === "ADMIN") throw new CustomerLifecycleError("FORBIDDEN");
  if (user.legalHoldAt) throw new CustomerLifecycleError("LEGAL_HOLD_ACTIVE");
  const now = new Date();
  await db.$transaction([
    db.session.deleteMany({ where: { userId: input.userId } }),
    db.user.update({ where: { id: input.userId }, data: { lifecycleState: "PRIVACY_REVIEW", privacyRequestedAt: now, retentionExpiresAt: input.retentionExpiresAt, suspendedAt: now } }),
    db.customerAccount.updateMany({ where: { id: { in: user.ownedAccounts.map((a) => a.id) } }, data: { lifecycleState: "PRIVACY_REVIEW", privacyRequestedAt: now, retentionExpiresAt: input.retentionExpiresAt } }),
    db.auditLog.create({ data: { actorId: input.actorId, action: "PRIVACY_DELETION_REQUESTED", targetType: "User", targetId: input.userId, metadata: { retentionConfigured: true } } }),
  ]);
}

export async function setLegalHold(input: { userId: string; actorId: string; enabled: boolean; reason?: string }) {
  const user = await db.user.findUnique({ where: { id: input.userId }, select: { role: true, ownedAccounts: { select: { id: true } } } });
  if (!user) throw new CustomerLifecycleError("NOT_FOUND");
  if (user.role === "ADMIN") throw new CustomerLifecycleError("FORBIDDEN");
  const now = input.enabled ? new Date() : null;
  const reason = input.enabled ? input.reason?.trim().slice(0, 240) || "Administrative legal hold" : null;
  await db.$transaction([
    db.user.update({ where: { id: input.userId }, data: { legalHoldAt: now, legalHoldReason: reason } }),
    db.customerAccount.updateMany({ where: { id: { in: user.ownedAccounts.map((a) => a.id) } }, data: { legalHoldAt: now, legalHoldReason: reason } }),
    db.auditLog.create({ data: { actorId: input.actorId, action: input.enabled ? "LEGAL_HOLD_APPLIED" : "LEGAL_HOLD_REMOVED", targetType: "User", targetId: input.userId, metadata: { reasonCode: input.enabled ? "ADMINISTRATIVE" : "RELEASED" } } }),
  ]);
}

export async function pseudonymizeCustomer(input: { userId: string; actorId: string }) {
  const report = await customerRetentionBlockers(input.userId);
  if (!report.canPseudonymize) throw new CustomerLifecycleError("PRIVACY_DELETION_BLOCKED", report.blockers);
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, include: { ownedAccounts: { select: { id: true } } } });
    if (user.lifecycleState !== "PRIVACY_REVIEW" && user.lifecycleState !== "CLOSED") throw new CustomerLifecycleError("PRIVACY_DELETION_BLOCKED", ["PRIVACY_REVIEW_REQUIRED"]);
    const now = new Date();
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.passwordCredential.deleteMany({ where: { userId: user.id } });
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await tx.verificationToken.deleteMany({ where: { identifier: user.email } });
    await tx.emailOutbox.updateMany({ where: { recipient: user.email }, data: { recipient: pseudonymousEmail(user.id), payload: { redacted: true, reason: "PRIVACY_MINIMIZATION" } } });
    await tx.user.update({ where: { id: user.id }, data: { email: pseudonymousEmail(user.id), emailHash: hashEmail(user.email), name: null, emailVerified: null, lifecycleState: "PSEUDONYMIZED", pseudonymizedAt: now, suspendedAt: now } });
    await tx.customerAccount.updateMany({ where: { id: { in: user.ownedAccounts.map((a) => a.id) } }, data: { displayName: "Former customer", billingEmail: pseudonymousEmail(user.id), taxId: null, lifecycleState: "PSEUDONYMIZED", pseudonymizedAt: now } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "CUSTOMER_PERSONAL_DATA_PSEUDONYMIZED", targetType: "User", targetId: user.id, metadata: { preservedHistory: true, emailHashRetained: true } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function markPurgeEligible(input: { userId: string; actorId: string }) {
  const report = await customerRetentionBlockers(input.userId);
  if (!report.canMarkPurgeEligible) throw new CustomerLifecycleError(report.blockers.includes("LEGAL_HOLD") ? "LEGAL_HOLD_ACTIVE" : "PURGE_NOT_ELIGIBLE", report.blockers);
  await db.$transaction([
    db.user.update({ where: { id: input.userId }, data: { lifecycleState: "PURGE_ELIGIBLE" } }),
    db.customerAccount.updateMany({ where: { ownerId: input.userId }, data: { lifecycleState: "PURGE_ELIGIBLE" } }),
    db.auditLog.create({ data: { actorId: input.actorId, action: "CUSTOMER_MARKED_PURGE_ELIGIBLE", targetType: "User", targetId: input.userId, metadata: { blockerCount: report.blockers.length } } }),
  ]);
}

export async function executeFinalPurge(input: { userId: string; actorId: string; confirmation: string }) {
  if (input.confirmation !== `PURGE ${input.userId}`) throw new CustomerLifecycleError("PURGE_CONFIRMATION_REQUIRED");
  const report = await customerRetentionBlockers(input.userId);
  if (!report.canPurge) throw new CustomerLifecycleError("PURGE_NOT_ELIGIBLE", report.blockers);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, include: { ownedAccounts: { select: { id: true } } } });
    if (user.lifecycleState !== "PURGE_ELIGIBLE") throw new CustomerLifecycleError("PURGE_NOT_ELIGIBLE", ["MARK_PURGE_ELIGIBLE_FIRST"]);
    const accountIds = user.ownedAccounts.map((account) => account.id);
    await tx.cart.deleteMany({ where: { accountId: { in: accountIds } } });
    await tx.invitation.deleteMany({ where: { accountId: { in: accountIds } } });
    await tx.customerAccount.deleteMany({ where: { id: { in: accountIds } } });
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await tx.user.delete({ where: { id: user.id } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "CUSTOMER_FINAL_PURGE_EXECUTED", targetType: "PurgedUser", targetId: input.userId, metadata: { integrityVerified: true } } });
    return { purged: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export function assertAccountOperational(account: { lifecycleState: string }) {
  if (account.lifecycleState !== "ACTIVE") throw new CustomerLifecycleError("CUSTOMER_CLOSURE_BLOCKED", ["ACCOUNT_NOT_ACTIVE"]);
}

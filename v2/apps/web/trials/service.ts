import "server-only";
import { randomUUID } from "node:crypto";
import {
  assertSelfServiceTrialAvailable,
  createTrialChangePlan,
  createTrialGrantPlan,
  normalizeSelfServiceTrialPersistenceConflict,
} from "@bke/trials/logic/trial-policy";
import { db } from "@/v2/platform/host/db";
import { encryptLicenseKey, generateLicenseKey, hashLicenseKey, randomToken } from "@/v2/platform/host/security/crypto";

export async function grantProductTrial(input: {
  accountId: string;
  editionId: string;
  source: "SELF_SERVICE" | "ADMIN";
  actorId: string;
  graceDays?: number;
}) {
  const now = new Date();
  const key = generateLicenseKey();

  try {
    return await db.$transaction(async (tx) => {
      const edition = await tx.edition.findFirst({
        where: { id: input.editionId, active: true, product: { active: true, archivedAt: null } },
        include: { product: true },
      });
      if (!edition) throw new Error("NOT_FOUND");

      const account = await tx.customerAccount.findUnique({ where: { id: input.accountId } });
      if (!account) throw new Error("NOT_FOUND");

      const plan = createTrialGrantPlan({
        source: input.source,
        graceDays: input.graceDays,
        now,
        facts: {
          productId: edition.productId,
          editionId: edition.id,
          productName: edition.product.name,
          editionName: edition.name,
          features: edition.features,
          maxUsers: edition.maxUsers,
          maxDevicesPerUser: edition.maxDevicesPerUser,
          updatePolicy: edition.updatePolicy,
        },
      });

      if (input.source === "SELF_SERVICE") {
        const existing = await tx.trialGrant.findFirst({
          where: {
            accountId: account.id,
            productId: edition.productId,
            selfServiceYear: plan.selfServiceYear!,
          },
          select: { id: true },
        });
        assertSelfServiceTrialAvailable(Boolean(existing));
      }

      const suffix = `${Date.now().toString(36).toUpperCase()}${randomToken(4).toUpperCase()}`;
      const order = await tx.order.create({
        data: {
          number: `BKE-TRIAL-${now.getUTCFullYear()}-${suffix}`,
          accountId: account.id,
          status: plan.order.status,
          currency: plan.order.currency,
          subtotalMinor: plan.order.subtotalMinor,
          taxMinor: plan.order.taxMinor,
          totalMinor: plan.order.totalMinor,
          paidAt: now,
          billingSnapshot: { name: account.displayName, email: account.billingEmail, trial: true },
          items: {
            create: {
              productId: edition.productId,
              priceId: plan.order.priceId,
              policyId: plan.order.policyId,
              productName: edition.product.name,
              priceName: `${edition.name} — ${plan.order.planName}`,
              quantity: 1,
              unitAmountMinor: 0,
              totalMinor: 0,
              billingType: plan.order.billingType,
              policySnapshot: { maxSeats: edition.maxUsers, maxDevicesPerSeat: edition.maxDevicesPerUser },
              editionId: edition.id,
              editionName: edition.name,
              planName: plan.order.planName,
              entitlementSnapshot: {
                features: [...plan.entitlement.features],
                maxUsers: plan.entitlement.maxUsers,
                maxDevicesPerUser: plan.entitlement.maxDevicesPerUser,
                updatePolicy: plan.entitlement.updatePolicy,
                trialEndsAt: plan.entitlement.trialEndsAt,
                graceEndsAt: plan.entitlement.graceEndsAt,
              },
            },
          },
        },
        include: { items: true },
      });

      const license = await tx.license.create({
        data: {
          publicId: randomUUID(),
          keyHash: hashLicenseKey(key),
          keyLastFour: key.slice(-4),
          keyCiphertext: encryptLicenseKey(key),
          accountId: account.id,
          orderId: order.id,
          orderItemId: order.items[0]!.id,
          productId: edition.productId,
          editionId: edition.id,
          status: plan.license.status,
          maxSeats: plan.license.maxSeats,
          maxDevicesPerSeat: plan.license.maxDevicesPerSeat,
          expiresAt: plan.license.expiresAt,
          events: {
            create: {
              type: plan.license.eventType,
              metadata: {
                trialEndsAt: plan.trialEndsAt,
                graceEndsAt: plan.graceEndsAt,
                source: plan.source,
              },
            },
          },
        },
      });

      const trial = await tx.trialGrant.create({
        data: {
          accountId: account.id,
          productId: edition.productId,
          editionId: edition.id,
          licenseId: license.id,
          source: plan.source,
          selfServiceYear: plan.selfServiceYear,
          trialStartsAt: plan.trialStartsAt,
          trialEndsAt: plan.trialEndsAt,
          graceEndsAt: plan.graceEndsAt,
          createdById: input.actorId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          accountId: account.id,
          action: plan.auditAction,
          targetType: "TrialGrant",
          targetId: trial.id,
          metadata: {
            productId: edition.productId,
            editionId: edition.id,
            trialDays: plan.trialDays,
            graceDays: plan.graceDays,
          },
        },
      });

      return trial;
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (input.source === "SELF_SERVICE") {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code === "P2002" || code === "P2034") normalizeSelfServiceTrialPersistenceConflict(code);
    }
    throw error;
  }
}

export async function changeTrial(input: {
  trialId: string;
  actorId: string;
  action: "SET_GRACE" | "REVOKE";
  graceDays?: number;
}) {
  return db.$transaction(async (tx) => {
    const trial = await tx.trialGrant.findUnique({ where: { id: input.trialId } });
    if (!trial) throw new Error("NOT_FOUND");

    const now = new Date();
    const plan = createTrialChangePlan({
      state: {
        revokedAt: trial.revokedAt,
        trialEndsAt: trial.trialEndsAt,
        graceEndsAt: trial.graceEndsAt,
      },
      action: input.action,
      graceDays: input.graceDays,
      now,
    });

    if (plan.action === "REVOKE") {
      if (plan.noop) return trial;
      await tx.trialGrant.update({ where: { id: trial.id }, data: { revokedAt: now } });
      if (plan.deactivateDevices) {
        await tx.deviceActivation.updateMany({
          where: { licenseId: trial.licenseId, active: true },
          data: { active: false, deactivatedAt: now },
        });
      }
      await tx.license.update({
        where: { id: trial.licenseId },
        data: {
          status: plan.licenseStatus,
          events: { create: { type: plan.licenseEventType, metadata: { actorId: input.actorId } } },
        },
      });
    } else {
      await tx.trialGrant.update({ where: { id: trial.id }, data: { graceEndsAt: plan.graceEndsAt } });
      await tx.license.update({
        where: { id: trial.licenseId },
        data: {
          expiresAt: plan.licenseExpiresAt,
          status: plan.licenseStatus,
          events: {
            create: {
              type: plan.licenseEventType,
              metadata: { actorId: input.actorId, graceDays: plan.graceDays },
            },
          },
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        accountId: trial.accountId,
        action: plan.auditAction,
        targetType: "TrialGrant",
        targetId: trial.id,
        metadata: plan.action === "SET_GRACE" ? { graceDays: plan.graceDays } : {},
      },
    });

    return tx.trialGrant.findUniqueOrThrow({ where: { id: trial.id } });
  });
}

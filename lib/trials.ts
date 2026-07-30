import "server-only";
import { db } from "@/lib/db";
import { addDays } from "@/lib/time";
import { encryptLicenseKey, generateLicenseKey, hashLicenseKey, randomToken } from "@/lib/security/crypto";

export async function grantProductTrial(input: { accountId: string; editionId: string; source: "SELF_SERVICE" | "ADMIN"; actorId: string; graceDays?: number }) {
  const graceDays = input.graceDays ?? 0;
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 14) throw new Error("INVALID_GRACE_PERIOD");
  const now = new Date();
  const year = now.getUTCFullYear();
  const trialEndsAt = addDays(now, 7);
  const graceEndsAt = addDays(trialEndsAt, graceDays);
  const key = generateLicenseKey();

  try { return await db.$transaction(async (tx) => {
    const edition = await tx.edition.findFirst({ where: { id: input.editionId, active: true, product: { active: true, archivedAt: null } }, include: { product: true } });
    if (!edition) throw new Error("NOT_FOUND");
    const account = await tx.customerAccount.findUnique({ where: { id: input.accountId } });
    if (!account) throw new Error("NOT_FOUND");
    if (input.source === "SELF_SERVICE") {
      const existing = await tx.trialGrant.findFirst({ where: { accountId: account.id, productId: edition.productId, selfServiceYear: year } });
      if (existing) throw new Error("TRIAL_ALREADY_USED_THIS_YEAR");
    }

    const suffix = `${Date.now().toString(36).toUpperCase()}${randomToken(4).toUpperCase()}`;
    const order = await tx.order.create({
      data: {
        number: `BKE-TRIAL-${year}-${suffix}`, accountId: account.id, status: "PAID", currency: "PHP", subtotalMinor: 0, taxMinor: 0, totalMinor: 0, paidAt: now,
        billingSnapshot: { name: account.displayName, email: account.billingEmail, trial: true },
        items: { create: { productId: edition.productId, priceId: `trial:${edition.id}`, policyId: edition.id, productName: edition.product.name, priceName: `${edition.name} — 7-day trial`, quantity: 1, unitAmountMinor: 0, totalMinor: 0, billingType: "ONE_TIME", policySnapshot: { maxSeats: edition.maxUsers, maxDevicesPerSeat: edition.maxDevicesPerUser }, editionId: edition.id, editionName: edition.name, planName: "7-day trial", entitlementSnapshot: { features: edition.features, maxUsers: edition.maxUsers, maxDevicesPerUser: edition.maxDevicesPerUser, updatePolicy: edition.updatePolicy, trialEndsAt, graceEndsAt } } },
      },
      include: { items: true },
    });
    const license = await tx.license.create({ data: { publicId: crypto.randomUUID(), keyHash: hashLicenseKey(key), keyLastFour: key.slice(-4), keyCiphertext: encryptLicenseKey(key), accountId: account.id, orderId: order.id, orderItemId: order.items[0]!.id, productId: edition.productId, editionId: edition.id, status: "ACTIVE", maxSeats: edition.maxUsers, maxDevicesPerSeat: edition.maxDevicesPerUser, expiresAt: graceEndsAt, events: { create: { type: "TRIAL_ISSUED", metadata: { trialEndsAt, graceEndsAt, source: input.source } } } } });
    const trial = await tx.trialGrant.create({ data: { accountId: account.id, productId: edition.productId, editionId: edition.id, licenseId: license.id, source: input.source, selfServiceYear: input.source === "SELF_SERVICE" ? year : null, trialStartsAt: now, trialEndsAt, graceEndsAt, createdById: input.actorId } });
    await tx.auditLog.create({ data: { actorId: input.actorId, accountId: account.id, action: input.source === "ADMIN" ? "TRIAL_GRANTED_BY_ADMIN" : "TRIAL_STARTED", targetType: "TrialGrant", targetId: trial.id, metadata: { productId: edition.productId, editionId: edition.id, trialDays: 7, graceDays } } });
    return trial;
  }, { isolationLevel: "Serializable" }); } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (input.source === "SELF_SERVICE" && (code === "P2002" || code === "P2034")) throw new Error("TRIAL_ALREADY_USED_THIS_YEAR");
    throw error;
  }
}

export async function changeTrial(input: { trialId: string; actorId: string; action: "SET_GRACE" | "REVOKE"; graceDays?: number }) {
  if (input.action === "SET_GRACE" && (!Number.isInteger(input.graceDays) || input.graceDays! < 0 || input.graceDays! > 14)) throw new Error("INVALID_GRACE_PERIOD");
  return db.$transaction(async (tx) => {
    const trial = await tx.trialGrant.findUnique({ where: { id: input.trialId } });
    if (!trial) throw new Error("NOT_FOUND");
    if (input.action === "REVOKE") {
      if (trial.revokedAt) return trial;
      const now = new Date();
      await tx.trialGrant.update({ where: { id: trial.id }, data: { revokedAt: now } });
      await tx.deviceActivation.updateMany({ where: { licenseId: trial.licenseId, active: true }, data: { active: false, deactivatedAt: now } });
      await tx.license.update({ where: { id: trial.licenseId }, data: { status: "REVOKED", events: { create: { type: "TRIAL_REVOKED", metadata: { actorId: input.actorId } } } } });
    } else {
      if (trial.revokedAt) throw new Error("TRIAL_REVOKED");
      const graceEndsAt = addDays(trial.trialEndsAt, input.graceDays!);
      await tx.trialGrant.update({ where: { id: trial.id }, data: { graceEndsAt } });
      await tx.license.update({ where: { id: trial.licenseId }, data: { expiresAt: graceEndsAt, status: graceEndsAt > new Date() ? "ACTIVE" : "EXPIRED", events: { create: { type: "TRIAL_GRACE_CHANGED", metadata: { actorId: input.actorId, graceDays: input.graceDays } } } } });
    }
    await tx.auditLog.create({ data: { actorId: input.actorId, accountId: trial.accountId, action: input.action === "REVOKE" ? "TRIAL_REVOKED" : "TRIAL_GRACE_CHANGED", targetType: "TrialGrant", targetId: trial.id, metadata: input.action === "SET_GRACE" ? { graceDays: input.graceDays } : {} } });
    return tx.trialGrant.findUniqueOrThrow({ where: { id: trial.id } });
  });
}

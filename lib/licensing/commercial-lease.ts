import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashLicenseKey } from "@/lib/security/crypto";
import { issueSignedLease } from "@/lib/licensing-agent";
import { nextLeaseLifecycle, requireProductVersion, type CommercialLeaseAction } from "@/lib/licensing/lifecycle";
import { activeCommercialSigningKey, ensureCommercialSigningKey } from "@/lib/licensing/signing-registry";
import { deviceIdentity } from "@/lib/licensing/product-identity";

export async function issueCommercialLease(input: { licenseKey: string; installationId: string; deviceId: string; operationId: string; action?: CommercialLeaseAction; label?: string; operatingSystem?: string; architecture?: string; predecessorLeaseId?: string }) {
  await ensureCommercialSigningKey();
  const signingKey = await activeCommercialSigningKey();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const license = await tx.license.findUnique({ where: { keyHash: hashLicenseKey(input.licenseKey) }, include: { product: { include: { versions: { where: { active: true, lifecycle: { in: ["STABLE", "LTS"] } }, orderBy: { releasedAt: "desc" }, take: 1, select: { version: true } } } }, account: { select: { lifecycleState: true } }, subscription: { select: { status: true } } } });
        if (!license || license.account.lifecycleState !== "ACTIVE" || license.status !== "ACTIVE" || (license.expiresAt && license.expiresAt < new Date())) throw new Error("INVALID_LICENSE");
        const operation = await tx.commercialLeaseOperation.findUnique({ where: { operationId: input.operationId } });
        if (!operation) {
          if (input.action !== "ACTIVATION") throw new Error("COMMERCIAL_OPERATION_REQUIRED");
          await tx.commercialLeaseOperation.create({ data: { operationId: input.operationId, licenseId: license.id, action: "ACTIVATION" } });
        } else {
          if (operation.licenseId !== license.id) throw new Error("OPERATION_LICENSE_MISMATCH");
          if (operation.status === "COMPLETED" && operation.resultLeaseId) {
            const metadata = (operation.metadata ?? {}) as Record<string, unknown>;
            if ((metadata.installationId !== undefined && metadata.installationId !== input.installationId) || (metadata.deviceId !== undefined && metadata.deviceId !== input.deviceId) || (input.predecessorLeaseId && metadata.predecessorLeaseId !== input.predecessorLeaseId)) throw new Error("OPERATION_INPUT_MISMATCH");
            const prior = await tx.licenseLeaseRecord.findUniqueOrThrow({ where: { leaseId: operation.resultLeaseId } });
            return { lease: { payload: prior.leasePayload, signature: prior.leaseSignature, key_id: prior.signerKeyId, algorithm: "Ed25519" as const } };
          }
          if (input.action && input.action !== operation.action) throw new Error("OPERATION_ACTION_MISMATCH");
        }
        const action = operation?.action ?? "ACTIVATION";
        if (action === "RENEWAL" && license.subscription?.status !== "ACTIVE") throw new Error("RENEWAL_NOT_ELIGIBLE");
        if (action === "TRANSFER") {
          const transferPolicyId = typeof operation?.metadata === "object" && operation.metadata && "policyId" in operation.metadata ? String((operation.metadata as { policyId?: unknown }).policyId) : "";
          if (!transferPolicyId) throw new Error("TRANSFER_NOT_ALLOWED");
          const item = await tx.orderItem.findUnique({ where: { id: license.orderItemId }, select: { policyId: true } });
          const transferable = item?.policyId === transferPolicyId ? await tx.licensePolicy.findUnique({ where: { id: item.policyId }, select: { transferable: true } }) : null;
          if (!transferable?.transferable) throw new Error("TRANSFER_NOT_ALLOWED");
        }
        const version = requireProductVersion(license.product.versions[0]?.version);
        const identity = deviceIdentity(input.deviceId);
        const deviceHash = identity.deviceHash;
        const existingDevice = await tx.deviceActivation.findUnique({ where: { licenseId_deviceHash: { licenseId: license.id, deviceHash } } });
        if (!existingDevice?.active) {
          const active = await tx.deviceActivation.count({ where: { licenseId: license.id, active: true } });
          if (active >= license.maxSeats * license.maxDevicesPerSeat) throw new Error("ACTIVATION_LIMIT");
          await tx.deviceActivation.upsert({ where: { licenseId_deviceHash: { licenseId: license.id, deviceHash } }, create: { licenseId: license.id, deviceHash, machineIdHint: identity.machineIdHint, label: input.label, operatingSystem: input.operatingSystem, architecture: input.architecture }, update: { active: true, deactivatedAt: null, lastSeenAt: new Date(), label: input.label, operatingSystem: input.operatingSystem, architecture: input.architecture } });
        } else await tx.deviceActivation.update({ where: { id: existingDevice.id }, data: { lastSeenAt: new Date(), label: input.label ?? existingDevice.label, operatingSystem: input.operatingSystem, architecture: input.architecture } });
        const previous = input.predecessorLeaseId
          ? await tx.licenseLeaseRecord.findFirst({ where: { leaseId: input.predecessorLeaseId, licenseId: license.id } })
          : await tx.licenseLeaseRecord.findFirst({ where: { licenseId: license.id, installationId: input.installationId, deviceId: input.deviceId }, orderBy: [{ generation: "desc" }, { serverRevision: "desc" }] });
        const lifecycle = nextLeaseLifecycle(previous);
        const leaseId = randomUUID(); const now = new Date(); const expiresAt = license.expiresAt ?? new Date(now.getTime() + 30 * 86400000);
        const lease = issueSignedLease({ lease_id: leaseId, generation: lifecycle.generation, server_revision: lifecycle.serverRevision, product_id: license.productId, installation_id: input.installationId, device_id: input.deviceId, version, issuer: "BKE Digital Solutions", issued_at: now.toISOString(), not_before: now.toISOString(), expires_at: expiresAt.toISOString(), key_id: signingKey.keyId, algorithm: "Ed25519", revoked: false, superseded_by: null }, signingKey.privateKey);
        const record = await tx.licenseLeaseRecord.create({ data: { licenseId: license.id, leaseId, generation: lifecycle.generation, serverRevision: lifecycle.serverRevision, installationId: input.installationId, deviceId: input.deviceId, version, status: "ACTIVE", action, operationId: input.operationId, signerKeyId: signingKey.keyId, expiresAt, leasePayload: lease.payload, leaseSignature: lease.signature, issuedAt: now } });
        if (previous) await tx.licenseLeaseRecord.update({ where: { id: previous.id }, data: { status: "SUPERSEDED", supersededById: record.id } });
        await tx.commercialLeaseOperation.update({ where: { operationId: input.operationId }, data: { status: "COMPLETED", resultLeaseId: leaseId, completedAt: now } });
        return { lease };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (attempt === 0 && error instanceof Error && /P20(00|01|02)/.test(error.message)) continue;
      throw error;
    }
  }
  throw new Error("COMMERCIAL_OPERATION_FAILED");
}

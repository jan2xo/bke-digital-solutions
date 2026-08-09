import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { activationSchema } from "@/lib/validation";
import { hashLicenseKey, sha256 } from "@/lib/security/crypto";
import { clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { issueSignedLease } from "@/lib/licensing-agent";
import { nextLeaseLifecycle, requireProductVersion } from "@/lib/licensing/lifecycle";

export async function POST(request: Request) {
  try {
    const input = activationSchema.parse(await request.json());
    if (!(await rateLimit(`activate:${clientIp(request)}:${input.licenseKey.slice(-4)}`, 20, 3600)).allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    const keyHash = hashLicenseKey(input.licenseKey);
    const result = await db.$transaction(async (tx) => {
      const license = await tx.license.findUnique({
        where: { keyHash },
        include: { edition: { select: { name: true, features: true, updatePolicy: true } }, product: { include: { versions: { where: { active: true }, orderBy: { releasedAt: "desc" }, take: 1, select: { version: true } } } }, account: { select: { lifecycleState: true } } },
      });
      if (!license || license.account.lifecycleState !== "ACTIVE" || license.status !== "ACTIVE" || (license.expiresAt && license.expiresAt < new Date())) throw new Error("INVALID_LICENSE");
      const version = requireProductVersion(license.product.versions[0]?.version);
      const deviceHash = sha256(input.deviceId);
      const hint = input.deviceId.slice(-8);
      const existing = await tx.deviceActivation.findUnique({ where: { licenseId_deviceHash: { licenseId: license.id, deviceHash } } });
      if (existing?.active) await tx.deviceActivation.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), operatingSystem: input.operatingSystem, architecture: input.architecture, label: input.label ?? existing.label } });
      else {
        const active = await tx.deviceActivation.count({ where: { licenseId: license.id, active: true } });
        if (active >= license.maxSeats * license.maxDevicesPerSeat) throw new Error("ACTIVATION_LIMIT");
        await tx.deviceActivation.upsert({ where: { licenseId_deviceHash: { licenseId: license.id, deviceHash } }, create: { licenseId: license.id, deviceHash, machineIdHint: hint, label: input.label, operatingSystem: input.operatingSystem, architecture: input.architecture }, update: { active: true, deactivatedAt: null, lastSeenAt: new Date(), machineIdHint: hint, label: input.label, operatingSystem: input.operatingSystem, architecture: input.architecture } });
        await tx.licenseEvent.create({ data: { licenseId: license.id, type: "ACTIVATED", metadata: { deviceHash } } });
      }
      const previous = await tx.licenseLeaseRecord.findFirst({ where: { licenseId: license.id, installationId: input.installationId, deviceId: input.deviceId }, orderBy: [{ generation: "desc" }, { serverRevision: "desc" }] });
      const lifecycle = nextLeaseLifecycle(previous);
      const leaseRecordId = randomUUID();
      const leaseId = randomUUID();
      const now = new Date();
      const expiresAt = license.expiresAt ?? new Date(now.getTime() + 30 * 86400000);
      const lease = issueSignedLease({ lease_id: leaseId, generation: lifecycle.generation, server_revision: lifecycle.serverRevision, product_id: license.productId, installation_id: input.installationId, device_id: input.deviceId, version, issuer: "BKE Digital Solutions", issued_at: now.toISOString(), not_before: now.toISOString(), expires_at: expiresAt.toISOString(), key_id: env.LICENSE_SIGNING_KEY_ID, algorithm: "Ed25519", revoked: false, superseded_by: null });
      await tx.licenseLeaseRecord.create({ data: { id: leaseRecordId, licenseId: license.id, leaseId, generation: lifecycle.generation, serverRevision: lifecycle.serverRevision, installationId: input.installationId, deviceId: input.deviceId, version, status: "ACTIVE", issuedAt: now } });
      if (previous) await tx.licenseLeaseRecord.update({ where: { id: previous.id }, data: { status: "SUPERSEDED", supersededById: leaseRecordId } });
      return { lease };
    }, { isolationLevel: "Serializable" });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = message === "ACTIVATION_LIMIT" ? "ACTIVATION_LIMIT" : message === "INVALID_LICENSE_VERSION" ? "INVALID_LICENSE_VERSION" : "INVALID_LICENSE";
    return NextResponse.json({ error: code }, { status: code === "ACTIVATION_LIMIT" || code === "INVALID_LICENSE_VERSION" ? 409 : 400 });
  }
}

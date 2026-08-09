import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activationSchema } from "@/lib/validation";
import { hashLicenseKey, sha256 } from "@/lib/security/crypto";
import { clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { issueSignedLease } from "@/lib/licensing-agent";
import { randomUUID } from "node:crypto";

export async function POST(request: Request) {
  try {
    const input = activationSchema.parse(await request.json());
    if (!(await rateLimit(`activate:${clientIp(request)}:${input.licenseKey.slice(-4)}`, 20, 3600)).allowed) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const keyHash = hashLicenseKey(input.licenseKey);
    const result = await db.$transaction(async (tx) => {
      const license = await tx.license.findUnique({
        where: { keyHash },
        include: { edition: { select: { name: true, features: true, updatePolicy: true } }, product: { include: { versions: { where: { active: true }, orderBy: { releasedAt: "desc" }, take: 1, select: { version: true } } } }, account: { select: { lifecycleState: true } } },
      });
      if (!license || license.account.lifecycleState !== "ACTIVE" || license.status !== "ACTIVE" || (license.expiresAt && license.expiresAt < new Date())) throw new Error("INVALID_LICENSE");
      const deviceHash = sha256(input.deviceId);
      const hint = input.deviceId.slice(-8);
      const existing = await tx.deviceActivation.findUnique({ where: { licenseId_deviceHash: { licenseId: license.id, deviceHash } } });
      if (existing?.active) {
        await tx.deviceActivation.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), operatingSystem: input.operatingSystem, architecture: input.architecture, label: input.label ?? existing.label } });
        return leaseResponse(license, input.installationId, input.deviceId);
      }
      const active = await tx.deviceActivation.count({ where: { licenseId: license.id, active: true } });
      const max = license.maxSeats * license.maxDevicesPerSeat;
      if (active >= max) throw new Error("ACTIVATION_LIMIT");
      await tx.deviceActivation.upsert({
        where: { licenseId_deviceHash: { licenseId: license.id, deviceHash } },
        create: { licenseId: license.id, deviceHash, machineIdHint: hint, label: input.label, operatingSystem: input.operatingSystem, architecture: input.architecture },
        update: { active: true, deactivatedAt: null, lastSeenAt: new Date(), machineIdHint: hint, label: input.label, operatingSystem: input.operatingSystem, architecture: input.architecture },
      });
      await tx.licenseEvent.create({ data: { licenseId: license.id, type: "ACTIVATED", metadata: { deviceHash } } });
      return leaseResponse(license, input.installationId, input.deviceId);
    }, { isolationLevel: "Serializable" });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error && error.message === "ACTIVATION_LIMIT" ? "ACTIVATION_LIMIT" : "INVALID_LICENSE";
    return NextResponse.json({ error: code }, { status: code === "ACTIVATION_LIMIT" ? 409 : 400 });
  }
}

function leaseResponse(license: { id: string; publicId: string; productId: string; expiresAt: Date | null; product: { versions: { version: string }[] }; edition: { name: string; features: unknown; updatePolicy: string } | null }, installationId: string, deviceId: string) {
  const now = new Date();
  const expiresAt = license.expiresAt ?? new Date(now.getTime() + 30 * 86400000);
  const keyId = process.env.LICENSE_SIGNING_KEY_ID ?? "development-ed25519-v1";
  const lease = issueSignedLease({ lease_id: randomUUID(), generation: 1, server_revision: 1, product_id: license.productId, installation_id: installationId, device_id: deviceId, version: license.product.versions[0]?.version ?? "0.0.0", issuer: "BKE Digital Solutions", issued_at: now.toISOString(), not_before: now.toISOString(), expires_at: expiresAt.toISOString(), key_id: keyId, algorithm: "Ed25519", revoked: false, superseded_by: null });
  return { lease };
}

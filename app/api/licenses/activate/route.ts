import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activationSchema } from "@/lib/validation";
import { hashLicenseKey, sha256 } from "@/lib/security/crypto";
import { clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";

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
        include: { edition: { select: { name: true, features: true, updatePolicy: true } } },
      });
      if (!license || license.status !== "ACTIVE" || (license.expiresAt && license.expiresAt < new Date())) throw new Error("INVALID_LICENSE");
      const deviceHash = sha256(input.deviceId);
      const hint = input.deviceId.slice(-8);
      const existing = await tx.deviceActivation.findUnique({ where: { licenseId_deviceHash: { licenseId: license.id, deviceHash } } });
      if (existing?.active) {
        await tx.deviceActivation.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), operatingSystem: input.operatingSystem, architecture: input.architecture, label: input.label ?? existing.label } });
        return entitlement(license);
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
      return entitlement(license);
    }, { isolationLevel: "Serializable" });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error && error.message === "ACTIVATION_LIMIT" ? "ACTIVATION_LIMIT" : "INVALID_LICENSE";
    return NextResponse.json({ error: code }, { status: code === "ACTIVATION_LIMIT" ? 409 : 400 });
  }
}

function entitlement(license: { publicId: string; expiresAt: Date | null; status: string; edition: { name: string; features: unknown; updatePolicy: string } | null }) {
  return {
    licenseId: license.publicId,
    expiresAt: license.expiresAt,
    status: license.status,
    edition: license.edition ? { name: license.edition.name, features: license.edition.features, updatePolicy: license.edition.updatePolicy } : null,
  };
}

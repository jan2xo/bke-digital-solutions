import type { LicenseLeaseRecord } from "@/generated/prisma/client";

export function refreshRequiresReplacement(current: Pick<LicenseLeaseRecord, "version" | "expiresAt" | "installationId" | "deviceId" | "signerKeyId" | "status" | "serverRevision">, expected: { version: string; expiresAt: Date | null; installationId: string; deviceId: string; signerKeyId: string }): boolean {
  return current.status !== "ACTIVE" || current.version !== expected.version || current.expiresAt?.getTime() !== expected.expiresAt?.getTime() || current.installationId !== expected.installationId || current.deviceId !== expected.deviceId || current.signerKeyId !== expected.signerKeyId || current.serverRevision < 1;
}

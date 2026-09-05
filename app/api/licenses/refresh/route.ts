import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { activationSchema } from "@/v2/apps/web/http/validation";
import { issueCommercialLease } from "@/lib/licensing/commercial-lease";
import { clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { decryptLicenseKey, hashLicenseKey } from "@/lib/security/crypto";
import { activeCommercialSigningKey } from "@/lib/licensing/signing-registry";
import { requireProductVersion } from "@/lib/licensing/lifecycle";
import { refreshRequiresReplacement } from "@bke/licensing/logic/refresh-decision";
import { CLOUD_AGENT_PROTOCOL_VERSION, CloudAgentProtocolError, requireCloudAgentVersion } from "@/v2/apps/web/licensing/cloud-agent-contract";

const schema = activationSchema.extend({ operationId: z.string().min(8).max(128), currentLeaseId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    requireCloudAgentVersion(request);
    const input = schema.parse(await request.json());
    if (!(await rateLimit(`refresh:${clientIp(request)}:${input.licenseKey.slice(-4)}`, 20, 3600)).allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    const license = await db.license.findUnique({
      where: { keyHash: hashLicenseKey(input.licenseKey) },
      include: { leaseHistory: true, product: { include: { versions: { where: { active: true, lifecycle: { in: ["STABLE", "LTS"] } }, orderBy: { releasedAt: "desc" }, take: 1, select: { version: true } } } } },
    });
    if (!license || license.status !== "ACTIVE" || (license.expiresAt && license.expiresAt < new Date())) throw new Error("INVALID_LICENSE");
    const current = license.leaseHistory.find((lease) => lease.leaseId === input.currentLeaseId && lease.installationId === input.installationId && lease.deviceId === input.deviceId);
    if (!current) throw new Error("REFRESH_BINDING_MISMATCH");
    const signingKey = await activeCommercialSigningKey();
    const expectedVersion = requireProductVersion(current.version);
    if (!refreshRequiresReplacement(current, { version: expectedVersion, expiresAt: license.expiresAt, installationId: input.installationId, deviceId: input.deviceId, signerKeyId: signingKey.keyId })) {
      const operation = await db.commercialLeaseOperation.upsert({ where: { operationId: input.operationId }, create: { operationId: input.operationId, licenseId: license.id, action: "REFRESH", status: "COMPLETED", resultLeaseId: current.leaseId, metadata: { currentLeaseId: input.currentLeaseId, installationId: input.installationId, deviceId: input.deviceId, decision: "REUSED" }, completedAt: new Date() }, update: {} });
      const metadata = (operation.metadata ?? {}) as Record<string, unknown>;
      if (metadata.currentLeaseId !== input.currentLeaseId || metadata.installationId !== input.installationId || metadata.deviceId !== input.deviceId) throw new Error("OPERATION_INPUT_MISMATCH");
      if (operation.resultLeaseId === current.leaseId) return NextResponse.json({ lease: { payload: current.leasePayload, signature: current.leaseSignature, key_id: current.signerKeyId, algorithm: "Ed25519" as const } }, { status: 200, headers: { "x-bke-licensing-version": CLOUD_AGENT_PROTOCOL_VERSION } });
    }
    await db.commercialLeaseOperation.upsert({ where: { operationId: input.operationId }, create: { operationId: input.operationId, licenseId: license.id, action: "REFRESH", metadata: { currentLeaseId: input.currentLeaseId, installationId: input.installationId, deviceId: input.deviceId, decision: "REPLACEMENT" } }, update: {} });
    return NextResponse.json(await issueCommercialLease({ licenseKey: decryptLicenseKey(license.keyCiphertext!), installationId: input.installationId, deviceId: input.deviceId, operationId: input.operationId, productVersion: current.version, action: "REFRESH" }), { status: 200, headers: { "x-bke-licensing-version": CLOUD_AGENT_PROTOCOL_VERSION } });
  } catch (error) {
    if (error instanceof CloudAgentProtocolError) return NextResponse.json({ error: error.code }, { status: error.status });
    const code = error instanceof Error && ["REFRESH_BINDING_MISMATCH", "INVALID_LICENSE_VERSION"].includes(error.message) ? error.message : "INVALID_LICENSE";
    return NextResponse.json({ error: code }, { status: code === "INVALID_LICENSE" ? 400 : 409 });
  }
}

import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import {
  canonicalEs256PublicKey,
  parseEs256EnrollmentCandidate,
  verifyEs256Possession,
} from "@/apps/web/agent-sessions/standalone-startup-es256-attestation";
import { revokeStartupMachineKeyInTransaction } from
  "@/apps/web/agent-sessions/startup-machine-trust-admin";

// Explicit ES256 v2 staging path. No account/session TPM key is imported, no
// self-asserted hardware-assurance tier, and no direct Agent HTTP enrollment.
const KID = /^[A-Za-z0-9._-]{1,128}$/;
const SHA = /^[0-9a-f]{64}$/;
type Row = Readonly<{
  kid: string; deviceId: string; publicKeyPem: string; publicKeySha256: string;
  algorithm: string; stagedBy: string; status: string;
}>;

async function requireAdmin(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId },
    select: { role: true, lifecycleState: true, suspendedAt: true } });
  if (!actor || actor.role !== "ADMIN" ||
      actor.lifecycleState !== "ACTIVE" || actor.suspendedAt)
    throw new Error("STARTUP_ES256_ADMIN_REQUIRED");
}
function requireFingerprint(actual: string, expected: string) {
  if (!SHA.test(actual) || !SHA.test(expected) ||
      !timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex")))
    throw new Error("STARTUP_ES256_FINGERPRINT_MISMATCH");
}

export async function stageStartupEs256MachineKeyInTransaction(
  tx: Prisma.TransactionClient,
  input: Readonly<{ candidate: string; reviewedFingerprintSha256: string }>,
  actorId: string,
) {
  await requireAdmin(tx, actorId);
  const c = parseEs256EnrollmentCandidate(input.candidate);
  requireFingerprint(c.fingerprintSha256, input.reviewedFingerprintSha256);
  const existing = await tx.$queryRaw<Array<{ kid: string }>>`
    SELECT "kid" FROM "AgentStartupAttestationSigningKey"
     WHERE "kid"=${c.kid} OR
       ("deviceId"=${c.deviceId} AND "status" IN ('STAGED','ACTIVE'))
     FOR UPDATE
  `;
  if (existing.length) throw new Error("STARTUP_ES256_ALREADY_STAGED");
  const inserted = await tx.$queryRaw<Array<{ kid: string }>>`
    INSERT INTO "AgentStartupAttestationSigningKey"
      ("kid","deviceId","algorithm","publicKeyPem","publicKeySha256",
       "stagedBy","status")
    VALUES (${c.kid},${c.deviceId},'ES256',${c.publicKeyPem},
            ${c.fingerprintSha256},${actorId},'STAGED')
    RETURNING "kid"
  `;
  if (inserted.length !== 1 || inserted[0]!.kid !== c.kid)
    throw new Error("STARTUP_ES256_STAGING_CONFLICT");
  await tx.auditLog.create({ data: { actorId,
    action: "AGENT_STARTUP_ES256_MACHINE_KEY_STAGED",
    targetType: "AgentStartupAttestationSigningKey", targetId: c.kid,
    metadata: { schema: "bke.startup-machine-key-review.v2",
      algorithm: "ES256", hardwareAttested: false,
      deviceId: c.deviceId, publicKeySha256: c.fingerprintSha256,
      status: "STAGED" } } });
  return Object.freeze({ kid: c.kid, publicKeySha256: c.fingerprintSha256,
    algorithm: "ES256" as const, status: "STAGED" as const });
}

export async function activateStartupEs256MachineKeyInTransaction(
  tx: Prisma.TransactionClient,
  input: Readonly<{ kid: string; confirmedFingerprintSha256: string;
    freshSignedInstallProof: string }>,
  actorId: string, now = new Date(),
) {
  await requireAdmin(tx, actorId);
  if (!KID.test(input.kid) || !Number.isFinite(now.getTime()))
    throw new Error("STARTUP_ES256_ACTIVATION_INVALID");
  const rows = await tx.$queryRaw<Row[]>`
    SELECT "kid","deviceId","publicKeyPem","publicKeySha256",
           "algorithm","stagedBy","status"
      FROM "AgentStartupAttestationSigningKey"
     WHERE "kid"=${input.kid} AND "algorithm"='ES256'
       AND "status"='STAGED' FOR UPDATE
  `;
  if (rows.length !== 1 || rows[0]!.algorithm !== "ES256" ||
      rows[0]!.status !== "STAGED" || !rows[0]!.stagedBy ||
      rows[0]!.stagedBy === actorId)
    throw new Error("STARTUP_ES256_INDEPENDENT_ADMIN_REQUIRED");
  const staged = rows[0]!;
  requireFingerprint(
    canonicalEs256PublicKey(staged.publicKeyPem).fingerprintSha256,
    staged.publicKeySha256);
  requireFingerprint(staged.publicKeySha256, input.confirmedFingerprintSha256);
  const proof = verifyEs256Possession(input.freshSignedInstallProof, {
    kid: staged.kid, deviceId: staged.deviceId,
    publicKeyPem: staged.publicKeyPem,
  }, now);
  const updated = await tx.$queryRaw<Array<{ kid: string }>>`
    UPDATE "AgentStartupAttestationSigningKey"
       SET "status"='ACTIVE',"activatedAt"=${now},"activatedBy"=${actorId},
           "reviewedAt"=${now},"activationProofSha256"=${proof.attestationSha256}
     WHERE "kid"=${staged.kid} AND "algorithm"='ES256'
       AND "status"='STAGED' AND "stagedBy"<>${actorId}
    RETURNING "kid"
  `;
  if (updated.length !== 1) throw new Error("STARTUP_ES256_ACTIVATION_CONFLICT");
  await tx.auditLog.create({ data: { actorId,
    action: "AGENT_STARTUP_ES256_MACHINE_KEY_ACTIVATED",
    targetType: "AgentStartupAttestationSigningKey", targetId: staged.kid,
    metadata: { schema: "bke.startup-machine-key-review.v2",
      algorithm: "ES256", hardwareAttested: false,
      deviceId: staged.deviceId, stagedBy: staged.stagedBy,
      publicKeySha256: staged.publicKeySha256,
      proofSha256: proof.attestationSha256, status: "ACTIVE" } } });
  return Object.freeze({ kid: staged.kid, algorithm: "ES256" as const,
    status: "ACTIVE" as const });
}

export async function revokeStartupEs256MachineKeyInTransaction(
  tx: Prisma.TransactionClient, kid: string, actorId: string, reason: string,
  now = new Date(),
) {
  await requireAdmin(tx, actorId);
  if (!KID.test(kid)) throw new Error("STARTUP_ES256_REVOCATION_INVALID");
  const rows = await tx.$queryRaw<Array<{ algorithm: string }>>`
    SELECT "algorithm" FROM "AgentStartupAttestationSigningKey"
     WHERE "kid"=${kid} AND "algorithm"='ES256' FOR UPDATE
  `;
  if (rows.length !== 1 || rows[0]!.algorithm !== "ES256")
    throw new Error("STARTUP_ES256_TRUST_UNKNOWN");
  return revokeStartupMachineKeyInTransaction(tx, kid, actorId, reason, now);
}

/** Real recent Google ADMIN session, production hard-lock, default OFF. */
async function runAdmin<T>(
  callback: (tx: Prisma.TransactionClient, actorId: string) => Promise<T>,
): Promise<T> {
  if (process.env.DEPLOYMENT_ENV === "production")
    throw new Error("STARTUP_ES256_PRODUCTION_LOCK");
  const { getRuntimeEnvironment } = await import("@/platform/host/env");
  const config = getRuntimeEnvironment();
  if (config.DEPLOYMENT_ENV === "production" ||
      !config.STARTUP_MACHINE_ENROLLMENT_ENABLED)
    throw new Error("STARTUP_ES256_ENROLLMENT_DISABLED");
  const { requireRecentIdentitySession } = await import("@/apps/web/auth/session");
  const identity = await requireRecentIdentitySession();
  if (identity.principal.role !== "ADMIN") throw new Error("FORBIDDEN");
  const { db } = await import("@/platform/host/db");
  return db.$transaction(tx => callback(tx, identity.principal.id),
    { isolationLevel: "Serializable", timeout: 10_000 });
}
export function stageStartupEs256MachineKeyPreproduction(
  candidate: string, reviewedFingerprintSha256: string,
) {
  return runAdmin((tx, id) => stageStartupEs256MachineKeyInTransaction(
    tx, { candidate, reviewedFingerprintSha256 }, id));
}
export function activateStartupEs256MachineKeyPreproduction(input: Readonly<{
  kid: string; confirmedFingerprintSha256: string; freshSignedInstallProof: string;
}>) {
  return runAdmin((tx, id) =>
    activateStartupEs256MachineKeyInTransaction(tx, input, id));
}
export function revokeStartupEs256MachineKeyPreproduction(
  kid: string, reason: string,
) {
  return runAdmin((tx, id) =>
    revokeStartupEs256MachineKeyInTransaction(tx, kid, id, reason));
}

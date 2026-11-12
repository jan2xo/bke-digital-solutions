import "server-only";

import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";

const CANDIDATE = "bke.agent-startup-attestation-enrollment-candidate.v1";
const ENVELOPE = "bke.agent-startup-install-attestation-envelope.v1";
const PAYLOAD = "bke.agent-startup-install-attestation.v1";
const DOMAIN = "BKE-AGENT-STARTUP-INSTALL-ATTESTATION-V1\n";
const KID = /^[A-Za-z0-9._-]{1,128}$/;
const DEVICE = /^[A-Za-z0-9._:-]{16,128}$/;
const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SIG = /^[A-Za-z0-9+/]{86}==$/;
type TrustRow = Readonly<{ kid: string; deviceId: string; publicKeyPem: string;
  publicKeySha256: string; stagedBy: string; status: string }>;

function object(raw: string, keys: readonly string[], max = 8192) {
  if (typeof raw !== "string" || raw.length > max || raw.length < 5 ||
      raw.includes("PRIVATE KEY"))
    throw new Error("MACHINE_KEY_INVALID_JSON");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("MACHINE_KEY_INVALID_JSON"); }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("MACHINE_KEY_INVALID_JSON");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length ||
      Object.keys(row).some((name, index) => name !== keys[index]) ||
      JSON.stringify(row) !== raw)
    throw new Error("MACHINE_KEY_NONCANONICAL_JSON");
  return row;
}
function field(row: Record<string, unknown>, key: string, max = 2048) {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0 ||
      value.length > max || (key !== "public_key_pem" && value.trim() !== value))
    throw new Error("MACHINE_KEY_INVALID_FIELD");
  return value;
}
function publicKey(pem: string) {
  try {
    if (pem.length > 2048 || !pem.startsWith("-----BEGIN PUBLIC KEY-----\n"))
      throw Error("BAD_KEY");
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519" ||
        key.export({ format: "pem", type: "spki" }).toString() !== pem)
      throw Error("BAD_KEY");
    return { key, sha: createHash("sha256")
      .update(key.export({ format: "der", type: "spki" })).digest("hex") };
  } catch { throw new Error("MACHINE_KEY_NOT_CANONICAL_ED25519"); }
}
function assertFingerprint(actual: string, expected: string) {
  if (!SHA.test(actual) || !SHA.test(expected))
    throw new Error("MACHINE_KEY_FINGERPRINT_INVALID");
  if (!timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex")))
    throw new Error("MACHINE_KEY_INDEPENDENT_FINGERPRINT_MISMATCH");
}
function parseCandidate(raw: string) {
  const c = object(raw, ["schema", "kid", "device_id", "public_key_pem", "status"]);
  if (field(c, "schema") !== CANDIDATE || field(c, "status") !== "STAGED")
    throw new Error("MACHINE_KEY_CANDIDATE_INVALID");
  const kid = field(c, "kid", 128);
  const device = field(c, "device_id", 128);
  if (!KID.test(kid) || !DEVICE.test(device))
    throw new Error("MACHINE_KEY_CANDIDATE_INVALID");
  const pem = field(c, "public_key_pem", 2048);
  return { kid, device, pem, sha: publicKey(pem).sha };
}
function possession(envelopeText: string, row: TrustRow, now: Date) {
  const outer = object(envelopeText,
    ["schema", "kid", "payload", "signature"], 16_384);
  if (field(outer, "schema") !== ENVELOPE ||
      field(outer, "kid") !== row.kid)
    throw new Error("MACHINE_KEY_PROOF_IDENTITY_MISMATCH");
  const raw = field(outer, "payload", 8192);
  const p = object(raw, ["schema", "product_id", "version", "installation_id",
    "image_path", "image_sha256", "allowed_user_sid", "device_id",
    "attestation_id", "issued_at", "expires_at"]);
  if (field(p, "schema") !== PAYLOAD ||
      field(p, "device_id") !== row.deviceId ||
      !UUID.test(field(p, "attestation_id", 64)))
    throw new Error("MACHINE_KEY_PROOF_IDENTITY_MISMATCH");
  const startedText = field(p, "issued_at", 64);
  const endedText = field(p, "expires_at", 64);
  const started = Date.parse(startedText);
  const ended = Date.parse(endedText);
  if (!Number.isFinite(started) || !Number.isFinite(ended) ||
      new Date(started).toISOString() !== startedText ||
      new Date(ended).toISOString() !== endedText ||
      started > now.getTime() || ended <= now.getTime() ||
      ended <= started || ended - started > 120_000)
    throw new Error("MACHINE_KEY_PROOF_EXPIRED");
  const encoded = field(outer, "signature", 128);
  if (!SIG.test(encoded)) throw new Error("MACHINE_KEY_PROOF_INVALID");
  const signature = Buffer.from(encoded, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== encoded ||
      !verify(null, Buffer.from(DOMAIN + raw, "utf8"),
        publicKey(row.publicKeyPem).key, signature))
    throw new Error("MACHINE_KEY_PROOF_INVALID");
  // This proves possession ONLY. DS issuance revalidates installed image/SID.
  return createHash("sha256").update(envelopeText).digest("hex");
}
async function admin(tx: Prisma.TransactionClient, actorId: string) {
  const user = await tx.user.findUnique({ where: { id: actorId },
    select: { role: true, lifecycleState: true, suspendedAt: true } });
  if (!user || user.role !== "ADMIN" ||
      user.lifecycleState !== "ACTIVE" || user.suspendedAt)
    throw new Error("MACHINE_KEY_ADMIN_REQUIRED");
}

/** Internal transaction helper, never directly exposed by HTTP. Caller actor
 * must be taken from the independently validated Google ADMIN session. */
export async function stageStartupMachineKeyInTransaction(
  tx: Prisma.TransactionClient,
  input: Readonly<{ candidate: string; reviewedFingerprintSha256: string }>,
  actorId: string,
) {
  await admin(tx, actorId);
  const c = parseCandidate(input.candidate);
  assertFingerprint(c.sha, input.reviewedFingerprintSha256);
  const existing = await tx.$queryRaw<Array<{ kid: string }>>`
    SELECT "kid" FROM "AgentStartupAttestationSigningKey"
     WHERE "kid"=${c.kid} OR ("deviceId"=${c.device} AND "status" IN ('STAGED','ACTIVE'))
     FOR UPDATE
  `;
  if (existing.length) throw new Error("MACHINE_KEY_ALREADY_STAGED");
  const inserted = await tx.$queryRaw<Array<{ kid: string }>>`
    INSERT INTO "AgentStartupAttestationSigningKey"
      ("kid","deviceId","publicKeyPem","publicKeySha256","stagedBy","status")
    VALUES (${c.kid}, ${c.device}, ${c.pem}, ${c.sha}, ${actorId}, 'STAGED')
    RETURNING "kid"
  `;
  if (inserted.length !== 1 || inserted[0]?.kid !== c.kid)
    throw new Error("MACHINE_KEY_STAGE_FAILED");
  await tx.auditLog.create({ data: { actorId,
    action: "AGENT_STARTUP_MACHINE_KEY_STAGED",
    targetType: "AgentStartupAttestationSigningKey", targetId: c.kid,
    metadata: { schema: "bke.startup-machine-key-review.v1",
      deviceId: c.device, publicKeySha256: c.sha, status: "STAGED" } } });
  return Object.freeze({ kid: c.kid, publicKeySha256: c.sha, status: "STAGED" as const });
}

export async function activateStartupMachineKeyInTransaction(
  tx: Prisma.TransactionClient,
  input: Readonly<{ kid: string; confirmedFingerprintSha256: string;
    freshSignedInstallProof: string }>,
  actorId: string, now = new Date(),
) {
  await admin(tx, actorId);
  if (!KID.test(input.kid) || !Number.isFinite(now.getTime()))
    throw new Error("MACHINE_KEY_ACTIVATION_INVALID");
  const rows = await tx.$queryRaw<TrustRow[]>`
    SELECT "kid","deviceId","publicKeyPem","publicKeySha256","stagedBy","status"
      FROM "AgentStartupAttestationSigningKey"
     WHERE "kid"=${input.kid} AND "status"='STAGED' FOR UPDATE
  `;
  if (rows.length !== 1 || rows[0]?.status !== "STAGED" ||
      !rows[0].stagedBy || rows[0].stagedBy === actorId)
    throw new Error("MACHINE_KEY_INDEPENDENT_ADMIN_REQUIRED");
  const staged = rows[0];
  assertFingerprint(publicKey(staged.publicKeyPem).sha, staged.publicKeySha256);
  assertFingerprint(staged.publicKeySha256, input.confirmedFingerprintSha256);
  const proofSha256 = possession(input.freshSignedInstallProof, staged, now);
  const updated = await tx.$queryRaw<Array<{ kid: string }>>`
    UPDATE "AgentStartupAttestationSigningKey"
       SET "status"='ACTIVE', "activatedAt"=${now}, "activatedBy"=${actorId},
           "reviewedAt"=${now}, "activationProofSha256"=${proofSha256}
     WHERE "kid"=${input.kid} AND "status"='STAGED' AND "stagedBy"<>${actorId}
    RETURNING "kid"
  `;
  if (updated.length !== 1) throw new Error("MACHINE_KEY_ACTIVATION_CONFLICT");
  await tx.auditLog.create({ data: { actorId,
    action: "AGENT_STARTUP_MACHINE_KEY_ACTIVATED",
    targetType: "AgentStartupAttestationSigningKey", targetId: staged.kid,
    metadata: { schema: "bke.startup-machine-key-review.v1",
      deviceId: staged.deviceId, stagedBy: staged.stagedBy,
      publicKeySha256: staged.publicKeySha256, proofSha256, status: "ACTIVE" } } });
  return Object.freeze({ kid: staged.kid, status: "ACTIVE" as const });
}

export async function revokeStartupMachineKeyInTransaction(
  tx: Prisma.TransactionClient, kid: string, actorId: string,
  reason: string, now = new Date(),
) {
  await admin(tx, actorId);
  if (!KID.test(kid) || typeof reason !== "string" ||
      reason.trim().length < 12 || reason.trim().length > 512 ||
      !Number.isFinite(now.getTime()))
    throw new Error("MACHINE_KEY_REVOCATION_INVALID");
  const rows = await tx.$queryRaw<Array<{ kid: string; status: string }>>`
    SELECT "kid","status" FROM "AgentStartupAttestationSigningKey"
     WHERE "kid"=${kid} FOR UPDATE
  `;
  if (rows.length !== 1 || !["STAGED", "ACTIVE"].includes(rows[0]!.status))
    throw new Error("MACHINE_KEY_ALREADY_REVOKED_OR_UNKNOWN");
  const updated = await tx.$queryRaw<Array<{ kid: string }>>`
    UPDATE "AgentStartupAttestationSigningKey"
       SET "status"='REVOKED', "revokedAt"=${now}, "revokedBy"=${actorId}
     WHERE "kid"=${kid} AND "status" IN ('STAGED','ACTIVE')
    RETURNING "kid"
  `;
  if (updated.length !== 1) throw new Error("MACHINE_KEY_REVOCATION_CONFLICT");
  await tx.auditLog.create({ data: { actorId,
    action: "AGENT_STARTUP_MACHINE_KEY_REVOKED",
    targetType: "AgentStartupAttestationSigningKey", targetId: kid,
    metadata: { schema: "bke.startup-machine-key-review.v1",
      priorStatus: rows[0]!.status,
      reasonSha256: createHash("sha256").update(reason.trim()).digest("hex"),
      status: "REVOKED" } } });
  return Object.freeze({ kid, status: "REVOKED" as const });
}

/** No actorId argument: the wrapper obtains the real recent Google ADMIN
 * session on every operation. No customer/Agent bearer can invoke this path. */
async function runAdmin<T>(
  action: (tx: Prisma.TransactionClient, actorId: string) => Promise<T>,
) {
  if (process.env.DEPLOYMENT_ENV === "production")
    throw new Error("MACHINE_KEY_PRODUCTION_LOCK");
  const { getRuntimeEnvironment } = await import("@/platform/host/env");
  const config = getRuntimeEnvironment();
  if (config.DEPLOYMENT_ENV === "production" ||
      !config.STARTUP_MACHINE_ENROLLMENT_ENABLED)
    throw new Error("MACHINE_KEY_ENROLLMENT_DISABLED");
  const { requireRecentIdentitySession } = await import("@/apps/web/auth/session");
  const identity = await requireRecentIdentitySession();
  if (identity.principal.role !== "ADMIN") throw new Error("FORBIDDEN");
  const { db } = await import("@/platform/host/db");
  return db.$transaction(
    tx => action(tx, identity.principal.id),
    { isolationLevel: "Serializable", timeout: 10_000 },
  );
}
export function stageStartupMachineKeyPreproduction(
  candidate: string, reviewedFingerprintSha256: string,
) {
  return runAdmin((tx, actorId) =>
    stageStartupMachineKeyInTransaction(tx,
      { candidate, reviewedFingerprintSha256 }, actorId));
}
export function activateStartupMachineKeyPreproduction(input: Readonly<{
  kid: string; confirmedFingerprintSha256: string; freshSignedInstallProof: string;
}>) {
  return runAdmin((tx, actorId) =>
    activateStartupMachineKeyInTransaction(tx, input, actorId));
}
export function revokeStartupMachineKeyPreproduction(kid: string, reason: string) {
  return runAdmin((tx, actorId) =>
    revokeStartupMachineKeyInTransaction(tx, kid, actorId, reason));
}

import "server-only";

import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { authenticateAgentAccessToken } from "./device-authorization";
import { hashAgentDeviceCode } from "./material";
import {
  prepareAccountProductLeaseClaims,
  type PrepareProductLeaseResult,
  type RegisteredAgentKeyProofEvidence,
} from "./product-lease-issuance-plan";
import type { ProductLeaseEligibilityDecision } from "./product-lease-eligibility-policy";

const CHALLENGE_TTL_MS = 30_000;
const REGISTRATION_TTL_MS = 24 * 60 * 60_000;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const trustBrand = Symbol("bke.ds.agent-proof-authority.internal");
const usedProofs = new WeakSet<object>();

/** Only produced after database challenge consumption and verified Ed25519 or P-256 signature. */
export type VerifiedAgentLeaseProof = Readonly<{
  [trustBrand]: true;
  registrationId: string;
  productId: string;
  action: "OPEN" | "USE";
  evidence: RegisteredAgentKeyProofEvidence;
}>;

type Session = Extract<
  Awaited<ReturnType<typeof authenticateAgentAccessToken>>,
  { status: "authenticated" }
>;
type RegistrationRow = Readonly<{
  id: string;
  sessionId: string;
  accountId: string;
  userId: string;
  deviceId: string;
  publicKeyPem: string;
  keyThumbprint: string;
  keyAlgorithm: "EdDSA" | "ES256";
  status: "PENDING" | "ACTIVE" | "REVOKED";
  validUntil: Date;
}>;
type ChallengeRow = Readonly<{
  id: string;
  registrationId: string;
  sessionId: string;
  purpose: "ENROLL" | "LEASE";
  productId: string | null;
  action: "OPEN" | "USE" | null;
  messageHash: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  status: "PENDING" | "ACTIVE" | "REVOKED";
  accountId: string;
  userId: string;
  deviceId: string;
  publicKeyPem: string;
  keyThumbprint: string;
  keyAlgorithm: "EdDSA" | "ES256";
  validUntil: Date;
}>;

export type KeyProofChallenge = Readonly<{
  status: "challenge";
  registrationId: string;
  challengeId: string;
  messageBase64url: string;
  expiresAt: Date;
}>;

type Rejection = Readonly<{ status: "denied"; reason:
  "INVALID_TOKEN" | "INVALID_KEY" | "REGISTRATION_CONFLICT" |
  "INVALID_CHALLENGE" | "BAD_SIGNATURE" | "KEY_REVOKED" | "INVALID_SCOPE" |
  "DEVICE_PROOF_REQUIRED" }>;

function currentMillis(now: Date): number {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error("AGENT_KEY_PROOF_CLOCK_INVALID");
  return now.getTime();
}

type AgentKeyAlgorithm = "EdDSA" | "ES256";

/**
 * Only canonical SPKI Ed25519 or NIST P-256 public keys are eligible.
 * An EC key and a valid signature prove possession, NOT TPM origin.
 */
function agentPublicKey(pem: string): Readonly<{
  pem: string; thumbprint: string; algorithm: AgentKeyAlgorithm;
}> | null {
  if (typeof pem !== "string" || pem.length > 4096 ||
      !/^-----BEGIN PUBLIC KEY-----\r?\n/.test(pem) ||
      !/\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(pem)) return null;
  try {
    const key = createPublicKey(pem);
    const algorithm: AgentKeyAlgorithm | null =
      key.asymmetricKeyType === "ed25519" ? "EdDSA" :
      key.asymmetricKeyType === "ec" &&
      key.asymmetricKeyDetails?.namedCurve === "prime256v1" ? "ES256" : null;
    if (!algorithm) return null;
    const canonical = key.export({ type: "spki", format: "pem" }).toString();
    const original = pem.replace(/\r\n/g, "\n").trimEnd() + "\n";
    if (canonical !== original) return null;
    return {
      pem: canonical, algorithm,
      thumbprint: createHash("sha256")
        .update(key.export({ type: "spki", format: "der" }))
        .digest("base64url"),
    };
  } catch { return null; }
}

/**
 * ES256 uses 64-byte IEEE-P1363 r||s on exact SHA-256(message), not ASN.1 DER.
 * EdDSA uses 64-byte RFC 8032 Ed25519 signature on exact message bytes.
 */
function verifyAgentSignature(
  algorithm: AgentKeyAlgorithm,
  pem: string,
  message: Buffer,
  signature: Buffer,
): boolean {
  if (signature.length !== 64) return false;
  const key = createPublicKey(pem);
  if (algorithm === "EdDSA") return verify(null, message, key, signature);
  return verify("sha256", message,
    { key, dsaEncoding: "ieee-p1363" }, signature);
}

function base64urlBytes(value: string, max: number): Buffer | null {
  if (typeof value !== "string" || value.length === 0 || value.length > max ||
      !BASE64URL.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.toString("base64url") === value ? bytes : null;
}

async function authenticated(
  tx: Prisma.TransactionClient,
  input: Readonly<{ accessToken: string; pepper: string }>,
): Promise<Session | null> {
  const result = await authenticateAgentAccessToken(tx, input);
  return result.status === "authenticated" ? result : null;
}

async function newChallenge(
  tx: Prisma.TransactionClient,
  session: Session,
  registration: RegistrationRow,
  purpose: "ENROLL" | "LEASE",
  productId: string | null,
  action: "OPEN" | "USE" | null,
  now: Date,
): Promise<KeyProofChallenge> {
  const id = randomUUID();
  const nonce = randomBytes(32).toString("base64url");
  // Domain separation + all authority dimensions are included in signed bytes.
  // No caller chooses the nonce, the registration/session or the challenge ID.
  const message = [
    "bke.agent-key-proof.v1", purpose, id, registration.id,
    session.sessionId, session.accountId, session.userId, session.deviceId,
    productId ?? "-", action ?? "-", nonce,
  ].join("\n");
  const bytes = Buffer.from(message, "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const expiresAt = new Date(currentMillis(now) + CHALLENGE_TTL_MS);
  await tx.$executeRaw`
    INSERT INTO "AgentLeaseKeyChallenge" (
      "id", "registrationId", "sessionId", "purpose", "productId", "action",
      "messageHash", "expiresAt", "createdAt"
    ) VALUES (
      ${id}, ${registration.id}, ${session.sessionId}, ${purpose},
      ${productId}, ${action}, ${digest}, ${expiresAt}, ${now}
    )
  `;
  return Object.freeze({
    status: "challenge" as const,
    registrationId: registration.id,
    challengeId: id,
    messageBase64url: bytes.toString("base64url"),
    expiresAt,
  });
}

/**
 * Source-only transaction capability: the caller must use SERIALIZABLE
 * isolation. Public bearer/session handling must NOT expose this as an API
 * until rate limits, token-bound provenance and key custody are certified.
 */
export async function beginAgentKeyEnrollment(
  tx: Prisma.TransactionClient,
  input: Readonly<{ accessToken: string; pepper: string; publicKeyPem: string; deviceCode: string }>,
  now = new Date(),
): Promise<KeyProofChallenge | Rejection> {
  const session = await authenticated(tx, input);
  if (!session) return { status: "denied", reason: "INVALID_TOKEN" };
  // Independent original device/native-handoff secret; never inferred from bearer.
  if (typeof input.deviceCode !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.deviceCode))
    return { status: "denied", reason: "DEVICE_PROOF_REQUIRED" };
  const deviceCodeHash = hashAgentDeviceCode(input.deviceCode, input.pepper);
  const authorized = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT a."id" FROM "AgentAccountSession" s
    JOIN "AgentDeviceAuthorization" a ON a."id" = s."deviceAuthorizationId"
    WHERE s."id" = ${session.sessionId}
      AND a."sessionId" = s."id"
      AND a."deviceCodeHash" = ${deviceCodeHash}
      AND a."deviceId" = ${session.deviceId}
      AND a."approvedByUserId" = ${session.userId}
      AND a."approvedAccountId" = ${session.accountId}
      AND a."status" = 'CONSUMED'
      AND a."consumedAt" IS NOT NULL
      AND a."authorizationKind" IN ('DEVICE_CODE','NATIVE_HANDOFF')
    FOR UPDATE OF a
  `;
  if (authorized.length !== 1)
    return { status: "denied", reason: "DEVICE_PROOF_REQUIRED" };
  const pub = agentPublicKey(input.publicKeyPem);
  if (!pub) return { status: "denied", reason: "INVALID_KEY" };
  const current = currentMillis(now);
  const existing = await tx.$queryRaw<RegistrationRow[]>`
    SELECT "id", "sessionId", "accountId", "userId", "deviceId",
           "publicKeyPem", "keyThumbprint", "keyAlgorithm", "status", "validUntil"
      FROM "AgentLeaseKeyRegistration" WHERE "sessionId" = ${session.sessionId}
     FOR UPDATE
  `;
  if (existing.length > 1) return { status: "denied", reason: "REGISTRATION_CONFLICT" };
  if (existing.length === 1) {
    const previous = existing[0]!;
    if (previous.status !== "PENDING" || previous.validUntil <= now ||
        previous.accountId !== session.accountId ||
        previous.userId !== session.userId ||
        previous.deviceId !== session.deviceId ||
        previous.keyThumbprint !== pub.thumbprint ||
        previous.keyAlgorithm !== pub.algorithm ||
        previous.publicKeyPem !== pub.pem)
      return { status: "denied", reason: "REGISTRATION_CONFLICT" };
    // Burn stale ENROLL nonces and retry with the exact same key and algorithm.
    await tx.$executeRaw`
      UPDATE "AgentLeaseKeyChallenge" SET "consumedAt" = ${now}
       WHERE "registrationId" = ${previous.id}
         AND "purpose" = 'ENROLL' AND "consumedAt" IS NULL
    `;
    return newChallenge(tx, session, previous, "ENROLL", null, null, now);
  }
  const id = randomUUID();
  const validUntil = new Date(current + REGISTRATION_TTL_MS);
  await tx.$executeRaw`
    INSERT INTO "AgentLeaseKeyRegistration" (
      "id", "sessionId", "accountId", "userId", "deviceId", "publicKeyPem",
      "keyThumbprint", "keyAlgorithm", "keyProtection", "status", "validUntil", "createdAt"
    ) VALUES (
      ${id}, ${session.sessionId}, ${session.accountId}, ${session.userId},
      ${session.deviceId}, ${pub.pem}, ${pub.thumbprint},
      ${pub.algorithm}, 'software', 'PENDING', ${validUntil}, ${now}
    )
  `;
  return newChallenge(tx, session, {
    id, sessionId: session.sessionId, accountId: session.accountId,
    userId: session.userId, deviceId: session.deviceId,
    publicKeyPem: pub.pem, keyThumbprint: pub.thumbprint,
    keyAlgorithm: pub.algorithm,
    status: "PENDING", validUntil,
  }, "ENROLL", null, null, now);
}

export async function beginAgentLeaseKeyChallenge(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    accessToken: string;
    pepper: string;
    registrationId: string;
    productId: string;
    action: "OPEN" | "USE";
  }>,
  now = new Date(),
): Promise<KeyProofChallenge | Rejection> {
  const session = await authenticated(tx, input);
  if (!session) return { status: "denied", reason: "INVALID_TOKEN" };
  const current = currentMillis(now);
  if (!input.productId || input.productId.length > 128 ||
      !/^[A-Za-z0-9._-]+$/.test(input.productId) ||
      (input.action !== "OPEN" && input.action !== "USE"))
    return { status: "denied", reason: "INVALID_SCOPE" };
  const rows = await tx.$queryRaw<RegistrationRow[]>`
    SELECT "id", "sessionId", "accountId", "userId", "deviceId",
           "publicKeyPem", "keyThumbprint", "keyAlgorithm", "status", "validUntil"
      FROM "AgentLeaseKeyRegistration" WHERE "id" = ${input.registrationId} FOR UPDATE
  `;
  const row = rows[0];
  if (!row || row.status !== "ACTIVE" || row.validUntil <= now ||
      row.sessionId !== session.sessionId || row.accountId !== session.accountId ||
      row.userId !== session.userId || row.deviceId !== session.deviceId)
    return { status: "denied", reason: "KEY_REVOKED" };
  if (row.validUntil.getTime() <= current)
    return { status: "denied", reason: "KEY_REVOKED" };
  return newChallenge(tx, session, row, "LEASE", input.productId, input.action, now);
}

/**
 * Real Ed25519 signature verification + atomic single-use challenge burn.
 * ENROLL proofs activate the PENDING key; LEASE proofs return an internal
 * nonserializable branded value for the unsigned claims composer.
 */
export async function verifyAgentKeyChallenge(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    accessToken: string;
    pepper: string;
    challengeId: string;
    messageBase64url: string;
    signatureBase64url: string;
    /** Internal LEASE consumers reject ENROLL before nonce burn. */
    expectedPurpose?: "LEASE";
  }>,
  now = new Date(),
): Promise<
  Rejection | Readonly<{ status: "enrolled"; registrationId: string }> |
  Readonly<{ status: "verified"; proof: VerifiedAgentLeaseProof }>
> {
  const session = await authenticated(tx, input);
  if (!session) return { status: "denied", reason: "INVALID_TOKEN" };
  const current = currentMillis(now);
  const rows = await tx.$queryRaw<ChallengeRow[]>`
    SELECT c."id", c."registrationId", c."sessionId", c."purpose", c."productId",
           c."action", c."messageHash", c."createdAt", c."expiresAt",
           c."consumedAt", r."status", r."accountId", r."userId", r."deviceId",
           r."publicKeyPem", r."keyThumbprint", r."keyAlgorithm", r."validUntil"
      FROM "AgentLeaseKeyChallenge" c
      JOIN "AgentLeaseKeyRegistration" r ON r."id" = c."registrationId"
     WHERE c."id" = ${input.challengeId}
     FOR UPDATE OF c, r
  `;
  const row = rows[0];
  if (!row || row.sessionId !== session.sessionId ||
      row.accountId !== session.accountId || row.userId !== session.userId ||
      row.deviceId !== session.deviceId)
    return { status: "denied", reason: "INVALID_CHALLENGE" };
  // A request scoped to LEASE must never activate an ENROLL registration.
  // Check purpose under the same row lock BEFORE consuming any nonce.
  if (input.expectedPurpose === "LEASE" && row.purpose !== "LEASE")
    return { status: "denied", reason: "INVALID_CHALLENGE" };
  if (row.consumedAt || row.expiresAt.getTime() <= current ||
      row.createdAt.getTime() > current || row.validUntil.getTime() <= current ||
      (row.purpose === "ENROLL" && row.status !== "PENDING") ||
      (row.purpose === "LEASE" && row.status !== "ACTIVE"))
    return { status: "denied", reason: "INVALID_CHALLENGE" };

  const consumed = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE "AgentLeaseKeyChallenge" SET "consumedAt" = ${now}
     WHERE "id" = ${row.id} AND "consumedAt" IS NULL
       AND "createdAt" <= ${now} AND "expiresAt" > ${now}
     RETURNING "id"
  `;
  if (consumed.length !== 1)
    return { status: "denied", reason: "INVALID_CHALLENGE" };

  const msg = base64urlBytes(input.messageBase64url, 4096);
  const signature = base64urlBytes(input.signatureBase64url, 128);
  const digest = msg ? createHash("sha256").update(msg).digest("hex") : null;
  const trustedKey = agentPublicKey(row.publicKeyPem);
  if (!msg || !signature || signature.length !== 64 ||
      digest !== row.messageHash || !trustedKey ||
      trustedKey.thumbprint !== row.keyThumbprint ||
      trustedKey.algorithm !== row.keyAlgorithm ||
      !verifyAgentSignature(trustedKey.algorithm, trustedKey.pem, msg, signature))
    return { status: "denied", reason: "BAD_SIGNATURE" };

  await tx.$executeRaw`
    UPDATE "AgentLeaseKeyChallenge" SET "verifiedAt" = ${now}
     WHERE "id" = ${row.id} AND "consumedAt" IS NOT NULL
  `;
  if (row.purpose === "ENROLL") {
    const activated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "AgentLeaseKeyRegistration" SET
        "status" = 'ACTIVE', "activatedAt" = ${now}
       WHERE "id" = ${row.registrationId} AND "status" = 'PENDING'
         AND "validUntil" > ${now}
       RETURNING "id"
    `;
    if (activated.length !== 1)
      return { status: "denied", reason: "INVALID_CHALLENGE" };
    await tx.auditLog.create({ data: {
      actorId: session.userId, accountId: session.accountId,
      action: "AGENT_LEASE_KEY_ENROLLED", targetType: "AgentLeaseKeyRegistration",
      targetId: row.registrationId,
      metadata: { sessionId: session.sessionId, deviceId: session.deviceId,
        keyThumbprint: row.keyThumbprint, keyAlgorithm: row.keyAlgorithm,
        keyProtection: "software" },
    } });
    return Object.freeze({ status: "enrolled" as const, registrationId: row.registrationId });
  }
  if (!row.productId || (row.action !== "OPEN" && row.action !== "USE"))
    return { status: "denied", reason: "INVALID_CHALLENGE" };
  const evidence: RegisteredAgentKeyProofEvidence = Object.freeze({
    registrationId: row.registrationId,
    registrationState: "ACTIVE" as const,
    accountId: session.accountId, userId: session.userId,
    agentSessionId: session.sessionId,
    registeredPublicKeyPem: row.publicKeyPem,
    proofPublicKeyPem: row.publicKeyPem,
    proofState: "VERIFIED" as const,
    proofVerifiedAt: now,
    registrationValidUntil: row.validUntil,
    claimedKeyProtection: "software" as const,
  });
  return Object.freeze({
    status: "verified" as const,
    proof: Object.freeze({
      [trustBrand]: true as const,
      registrationId: row.registrationId,
      productId: row.productId,
      action: row.action,
      evidence,
    }),
  });
}

/**
 * Hard boundary between cryptographic proof and an eligible L2 decision.
 * The branded proof is minted only by verifyAgentKeyChallenge above, never
 * by caller JSON; action/product/session/account/user are rechecked.
 * Still source-only: no issuer key or HTTP endpoint is introduced.
 */
export function prepareLeaseClaimsWithVerifiedKey(
  eligibility: ProductLeaseEligibilityDecision,
  proof: VerifiedAgentLeaseProof | null,
  now = new Date(),
): PrepareProductLeaseResult {
  if (!proof || proof[trustBrand] !== true || eligibility.status !== "eligible" ||
      proof.productId !== eligibility.productId ||
      proof.action !== eligibility.action ||
      proof.evidence.accountId !== eligibility.accountId ||
      proof.evidence.userId !== eligibility.userId ||
      proof.evidence.agentSessionId !== eligibility.sessionId)
    return { status: "denied", reason: "UNTRUSTED_MACHINE_KEY" };
  // Do not permit a verified nonce to prepare multiple execution leases.
  // Future signing must also check live registration/revocation in the same
  // trusted SERIALIZABLE transaction immediately before issuing a JWS.
  if (usedProofs.has(proof))
    return { status: "denied", reason: "UNTRUSTED_MACHINE_KEY" };
  usedProofs.add(proof);
  return prepareAccountProductLeaseClaims(eligibility, proof.evidence, now);
}

export async function revokeAgentLeaseKey(
  tx: Prisma.TransactionClient,
  input: Readonly<{ accessToken: string; pepper: string; registrationId: string }>,
  now = new Date(),
): Promise<Readonly<{ status: "revoked" | "already_revoked" }> | Rejection> {
  const session = await authenticated(tx, input);
  if (!session) return { status: "denied", reason: "INVALID_TOKEN" };
  const rows = await tx.$queryRaw<RegistrationRow[]>`
    SELECT "id", "sessionId", "accountId", "userId", "deviceId", "publicKeyPem",
           "keyThumbprint", "status", "validUntil"
      FROM "AgentLeaseKeyRegistration"
     WHERE "id" = ${input.registrationId} FOR UPDATE
  `;
  const row = rows[0];
  if (!row || row.sessionId !== session.sessionId ||
      row.accountId !== session.accountId || row.userId !== session.userId ||
      row.deviceId !== session.deviceId)
    return { status: "denied", reason: "KEY_REVOKED" };
  if (row.status === "REVOKED") return { status: "already_revoked" };
  await tx.$executeRaw`
    UPDATE "AgentLeaseKeyRegistration" SET "status" = 'REVOKED', "revokedAt" = ${now}
     WHERE "id" = ${row.id} AND "status" IN ('PENDING','ACTIVE')
  `;
  await tx.$executeRaw`
    UPDATE "AgentLeaseKeyChallenge" SET "consumedAt" = ${now}
     WHERE "registrationId" = ${row.id} AND "consumedAt" IS NULL
  `;
  await tx.auditLog.create({ data: {
    actorId: session.userId, accountId: session.accountId,
    action: "AGENT_LEASE_KEY_REVOKED", targetType: "AgentLeaseKeyRegistration",
    targetId: row.id, metadata: { sessionId: session.sessionId, deviceId: session.deviceId },
  } });
  return { status: "revoked" };
}

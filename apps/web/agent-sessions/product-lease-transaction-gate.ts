import "server-only";

import { createHash, createPublicKey } from "node:crypto";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { checkAgentProductLeaseEligibilityInTransaction } from "./product-lease-eligibility";
import {
  prepareLeaseClaimsWithVerifiedKey,
  type VerifiedAgentLeaseProof,
} from "./agent-key-proof-authority";
import type { PrepareProductLeaseResult } from "./product-lease-issuance-plan";

/**
 * SOURCE-ONLY final authority gate for future account-product JWS issuance.
 *
 * The caller MUST use a single SERIALIZABLE transaction for proof verification,
 * eligibility, this registration FOR UPDATE lock, signing and the issuance audit.
 * Do not return the claims or JWS from an HTTP route until the immutable shared
 * @bke/licensing package, DS signer custody/rotation and audit are certified.
 * A locally valid nonce or a client-supplied registration id is never enough.
 */
type RegisteredKeyRow = Readonly<{
  id: string;
  sessionId: string;
  accountId: string;
  userId: string;
  publicKeyPem: string;
  keyThumbprint: string;
  keyAlgorithm: "EdDSA" | "ES256";
  status: "PENDING" | "ACTIVE" | "REVOKED";
  validUntil: Date;
}>;

export type TransactionLeasePreparationResult = PrepareProductLeaseResult |
  Readonly<{ status: "denied"; reason: "INVALID_TOKEN" }>; 

function canonicalKey(pem: string): { thumbprint: string; algorithm: "EdDSA" | "ES256" } | null {
  if (typeof pem !== "string" || pem.length > 4096) return null;
  try {
    const key = createPublicKey(pem);
    const algorithm = key.asymmetricKeyType === "ed25519" ? "EdDSA" :
      key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1"
        ? "ES256" : null;
    if (!algorithm) return null;
    const canonical = key.export({ format: "pem", type: "spki" }).toString();
    if (pem.replace(/\r\n/g, "\n").trimEnd() + "\n" !== canonical) return null;
    return {
      algorithm,
      thumbprint: createHash("sha256")
        .update(key.export({ format: "der", type: "spki" })).digest("base64url"),
    };
  } catch { return null; }
}

export async function prepareVerifiedProductLeaseInTransaction(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    accessToken: string;
    pepper: string;
    productId: string;
    platform: "windows" | "macos" | "linux";
    architecture: "x64" | "arm64" | "x86";
    action: "OPEN" | "USE";
    proof: VerifiedAgentLeaseProof | null;
  }>,
  now = new Date(),
): Promise<TransactionLeasePreparationResult> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    return { status: "denied", reason: "INVALID_CONTEXT" };

  // L2 identity/account/seat/entitlement rights come from the live authenticated
  // Agent bearer and current DS catalog, not the caller or stale claims.
  const eligibility = await checkAgentProductLeaseEligibilityInTransaction(tx, {
    accessToken: input.accessToken, pepper: input.pepper,
    productId: input.productId, platform: input.platform,
    architecture: input.architecture, action: input.action,
  }, now);
  if (eligibility.status === "invalid_token")
    return { status: "denied", reason: "INVALID_TOKEN" };
  if (eligibility.status !== "eligible")
    return { status: "denied", reason: "NOT_ELIGIBLE" };

  const proof = input.proof;
  if (!proof || typeof proof.registrationId !== "string" ||
      !proof.registrationId || !proof.evidence ||
      proof.evidence.registrationId !== proof.registrationId ||
      proof.productId !== eligibility.productId || proof.action !== eligibility.action)
    return { status: "denied", reason: "UNTRUSTED_MACHINE_KEY" };

  // Lock the currently persisted registration until the enclosing transaction
  // ends. Revocation and key replacement must never race past issuance.
  const rows = await tx.$queryRaw<RegisteredKeyRow[]>`
    SELECT "id", "sessionId", "accountId", "userId", "publicKeyPem",
           "keyThumbprint", "keyAlgorithm", "status", "validUntil"
      FROM "AgentLeaseKeyRegistration"
     WHERE "id" = ${proof.registrationId} AND "sessionId" = ${eligibility.sessionId}
     FOR UPDATE
  `;
  if (rows.length !== 1) return { status: "denied", reason: "UNTRUSTED_MACHINE_KEY" };
  const row = rows[0]!;
  const key = canonicalKey(row.publicKeyPem);
  if (!key || row.status !== "ACTIVE" ||
      !(row.validUntil instanceof Date) || row.validUntil.getTime() <= now.getTime() ||
      row.id !== proof.registrationId ||
      row.sessionId !== eligibility.sessionId || row.accountId !== eligibility.accountId ||
      row.userId !== eligibility.userId ||
      row.publicKeyPem !== proof.evidence.registeredPublicKeyPem ||
      row.keyThumbprint !== key.thumbprint || row.keyAlgorithm !== key.algorithm ||
      proof.evidence.proofPublicKeyPem !== row.publicKeyPem ||
      proof.evidence.registrationValidUntil.getTime() !== row.validUntil.getTime())
    return { status: "denied", reason: "UNTRUSTED_MACHINE_KEY" };

  // Only the proof authority can mint the branded one-use value; it will reject
  // replay and mismatch when producing the exact bounded unsigned JWS claims.
  return prepareLeaseClaimsWithVerifiedKey(eligibility, proof, now);
}

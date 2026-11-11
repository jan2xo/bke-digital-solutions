/**
 * Digital Solutions pre-signing authorization projection for the pinned
 * @bke/licensing account-product JWS v1 wire contract (library PR #90).
 *
 * SOURCE-ONLY FRACTION. No route, signature, key loader or database mutation.
 * Inputs MUST eventually come from a server-authenticated L2 transaction and
 * an independently implemented, trusted Agent key/PoP registration service.
 * Neither an arbitrary client "verified" label nor this function alone is
 * an authentication or possession proof.
 */
import { createHash, createPublicKey, randomUUID } from "node:crypto";
import type { ProductLeaseEligibilityDecision } from "./product-lease-eligibility-policy";

export const PRODUCT_LEASE_SIGNING_SCHEMA = "bke.product-lease.v1" as const;
export const PRODUCT_LEASE_ISSUER = "BKE Digital Solutions" as const;
export const PRODUCT_LEASE_AUDIENCE = "bke-product" as const;
export const PRODUCT_LEASE_MAX_TTL_MS = 5 * 60_000;
const MAX_PROOF_AGE_MS = 30_000;
const MIN_LEASE_MS = 1_000;
const REFRESH_FACTOR = 0.5;

/**
 * Only the future server-owned proof authority may assemble this evidence.
 * A self-asserted client field, including keyProtection or verified=true,
 * is NOT a cryptographically verified Agent key registration.
 */
export type RegisteredAgentKeyProofEvidence = Readonly<{
  registrationId: string;
  registrationState: "ACTIVE" | "REVOKED" | "PENDING";
  accountId: string;
  userId: string;
  agentSessionId: string;
  registeredPublicKeyPem: string;
  /** Separately verified challenge response's actual public key. */
  proofPublicKeyPem: string;
  proofState: "VERIFIED" | "UNVERIFIED";
  proofVerifiedAt: Date;
  registrationValidUntil: Date;
  /** This must NOT be blindly promoted to "tpm" in signed claims. */
  claimedKeyProtection: "tpm" | "software";
}>;

export type PreparedProductLeaseClaims = Readonly<{
  schema: typeof PRODUCT_LEASE_SIGNING_SCHEMA;
  issuer: typeof PRODUCT_LEASE_ISSUER;
  audience: typeof PRODUCT_LEASE_AUDIENCE;
  leaseId: string;
  accountId: string;
  userId: string;
  productId: string;
  agentSessionId: string;
  agentKeyThumbprint: string;
  keyProtection: "software";
  plan: "trial" | "subscription" | "perpetual";
  allowedActions: readonly ("OPEN" | "USE")[];
  issuedAt: string;
  refreshAfter: string;
  expiresAt: string;
}>;

export type PrepareProductLeaseResult =
  | Readonly<{ status: "ready_to_sign"; claims: PreparedProductLeaseClaims }>
  | Readonly<{ status: "denied"; reason:
      "NOT_ELIGIBLE" | "INVALID_CONTEXT" | "UNTRUSTED_MACHINE_KEY" |
      "STALE_KEY_PROOF" | "RIGHTS_EXPIRE_TOO_SOON" }>;

function time(date: Date | null | undefined): number | null {
  if (!(date instanceof Date)) return null;
  const n = date.getTime();
  return Number.isFinite(n) ? n : null;
}

function verifiedEd25519Thumbprint(publicKeyPem: string): string | null {
  if (typeof publicKeyPem !== "string" || publicKeyPem.length > 8192)
    return null;
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") return null;
    const spki = key.export({ format: "der", type: "spki" });
    return createHash("sha256").update(spki).digest("base64url");
  } catch {
    return null;
  }
}

export function prepareAccountProductLeaseClaims(
  eligibility: ProductLeaseEligibilityDecision,
  keyEvidence: RegisteredAgentKeyProofEvidence | null,
  now: Date,
): PrepareProductLeaseResult {
  if (eligibility.status !== "eligible")
    return { status: "denied", reason: "NOT_ELIGIBLE" };

  const current = time(now);
  const rightsEnd = eligibility.rightsExpireNoLaterThan === null
    ? null : time(eligibility.rightsExpireNoLaterThan);
  if (current === null ||
      !eligibility.sessionId || !eligibility.accountId || !eligibility.userId ||
      !eligibility.productId || !eligibility.entitlementId || !eligibility.licenseId ||
      !["OPEN", "USE"].includes(eligibility.action) ||
      !["trial", "subscription", "perpetual"].includes(eligibility.plan) ||
      (eligibility.rightsExpireNoLaterThan !== null && rightsEnd === null))
    return { status: "denied", reason: "INVALID_CONTEXT" };

  if (!keyEvidence || keyEvidence.registrationState !== "ACTIVE" ||
      keyEvidence.proofState !== "VERIFIED" ||
      !keyEvidence.registrationId ||
      keyEvidence.accountId !== eligibility.accountId ||
      keyEvidence.userId !== eligibility.userId ||
      keyEvidence.agentSessionId !== eligibility.sessionId ||
      !["tpm", "software"].includes(keyEvidence.claimedKeyProtection))
    return { status: "denied", reason: "UNTRUSTED_MACHINE_KEY" };

  const proofAt = time(keyEvidence.proofVerifiedAt);
  const registrationEnd = time(keyEvidence.registrationValidUntil);
  if (proofAt === null || registrationEnd === null ||
      proofAt > current || current - proofAt > MAX_PROOF_AGE_MS)
    return { status: "denied", reason: "STALE_KEY_PROOF" };
  if (registrationEnd <= current)
    return { status: "denied", reason: "UNTRUSTED_MACHINE_KEY" };

  const registeredThumbprint = verifiedEd25519Thumbprint(keyEvidence.registeredPublicKeyPem);
  const provedThumbprint = verifiedEd25519Thumbprint(keyEvidence.proofPublicKeyPem);
  if (!registeredThumbprint || registeredThumbprint !== provedThumbprint)
    return { status: "denied", reason: "UNTRUSTED_MACHINE_KEY" };

  const expiresAtMs = Math.min(
    current + PRODUCT_LEASE_MAX_TTL_MS,
    rightsEnd ?? Number.POSITIVE_INFINITY,
    registrationEnd,
  );
  if (expiresAtMs <= current + MIN_LEASE_MS)
    return { status: "denied", reason: "RIGHTS_EXPIRE_TOO_SOON" };

  const refreshAfterMs = current + Math.floor((expiresAtMs - current) * REFRESH_FACTOR);
  if (refreshAfterMs <= current || refreshAfterMs >= expiresAtMs)
    return { status: "denied", reason: "RIGHTS_EXPIRE_TOO_SOON" };

  // Exactly the v1 JWS claim keys from immutable source reference in library
  // PR #90. No private key / bearer token / entitlement audit details leak.
  const claims: PreparedProductLeaseClaims = Object.freeze({
    schema: PRODUCT_LEASE_SIGNING_SCHEMA,
    issuer: PRODUCT_LEASE_ISSUER,
    audience: PRODUCT_LEASE_AUDIENCE,
    leaseId: randomUUID(),
    accountId: eligibility.accountId,
    userId: eligibility.userId,
    productId: eligibility.productId,
    agentSessionId: eligibility.sessionId,
    agentKeyThumbprint: registeredThumbprint,
    // A claimed "tpm" label alone cannot prove hardware attestation.
    keyProtection: "software" as const,
    plan: eligibility.plan,
    allowedActions: Object.freeze([eligibility.action]),
    issuedAt: new Date(current).toISOString(),
    refreshAfter: new Date(refreshAfterMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
  });

  return Object.freeze({ status: "ready_to_sign" as const, claims });
}

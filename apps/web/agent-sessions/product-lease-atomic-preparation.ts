import "server-only";

import { db } from "@/platform/host/db";
import { verifyAgentKeyChallenge } from "./agent-key-proof-authority";
import {
  auditDeniedProductLeasePreparationInTransaction,
  prepareAndAuditProductLeaseInTransaction,
} from "./product-lease-preparation-audit";

/**
 * Internal SOURCE-ONLY transaction owner for Agent lease proof and PREPARED audit.
 *
 * The same SERIALIZABLE transaction checks and burns the one-time challenge,
 * authenticates live entitlement and machine-key registration, and journals
 * PREPARED or DENIED. No HTTP route calls this function. In particular the
 * result is not an issued JWS and MUST NOT authorize local product execution.
 *
 * Future JWS signing requires an independently released shared library,
 * DS-owned key custody and an ISSUED audit before transaction commit.
 */
export async function verifyAndAuditAgentProductLeasePreparation(
  input: Readonly<{
    accessToken: string;
    pepper: string;
    challengeId: string;
    messageBase64url: string;
    signatureBase64url: string;
    productId: string;
    platform: "windows" | "macos" | "linux";
    architecture: "x64" | "arm64" | "x86";
    action: "OPEN" | "USE";
  }>,
  now = new Date(),
) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("PRODUCT_LEASE_PREPARATION_CLOCK_INVALID");
  }

  // No externally owned transaction or independent commit is accepted.
  // Audit failures throw and force rollback, including the nonce consumption.
  return db.$transaction(async (tx) => {
    const verified = await verifyAgentKeyChallenge(tx, {
      accessToken: input.accessToken,
      pepper: input.pepper,
      challengeId: input.challengeId,
      messageBase64url: input.messageBase64url,
      signatureBase64url: input.signatureBase64url,
      expectedPurpose: "LEASE",
    }, now);

    if (verified.status !== "verified") {
      // ENROLL must never be considered a lease proof even if a caller has
      // an otherwise valid enrollment signature. The proof authority's
      // purpose check runs BEFORE nonce consumption or key activation.
      const reason = verified.status === "denied"
        ? verified.reason : "INVALID_CHALLENGE" as const;
      await auditDeniedProductLeasePreparationInTransaction(tx, reason);
      return { status: "denied" as const, reason };
    }

    return prepareAndAuditProductLeaseInTransaction(tx, {
      accessToken: input.accessToken,
      pepper: input.pepper,
      productId: input.productId,
      platform: input.platform,
      architecture: input.architecture,
      action: input.action,
      proof: verified.proof,
    }, now);
  }, { isolationLevel: "Serializable", timeout: 10_000 });
}

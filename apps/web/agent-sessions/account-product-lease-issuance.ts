import "server-only";

import { createHash } from "node:crypto";
import { db } from "@/platform/host/db";
import { verifyAgentKeyChallenge } from "./agent-key-proof-authority";
import {
  auditDeniedProductLeasePreparationInTransaction,
  prepareAndAuditProductLeaseInTransaction,
} from "./product-lease-preparation-audit";
import { signAccountProductLeaseInTransaction } from "./account-product-lease-signer";

export type IssueAgentAccountProductLeaseInput = Readonly<{
  accessToken: string;
  pepper: string;
  challengeId: string;
  messageBase64url: string;
  signatureBase64url: string;
  productId: string;
  platform: "windows" | "macos" | "linux";
  architecture: "x64" | "arm64" | "x86";
  action: "OPEN" | "USE";
}>;

/**
 * Only this server-owned operation turns verified Agent LEASE proof into a JWS.
 * - One non-retried SERIALIZABLE transaction: nonce consumption, live
 *   entitlement and registration locks, signed JWS, PREPARED + ISSUED audit.
 * - The signed bytes are returned ONLY after that transaction commits.
 * - On any signing/audit/commit error the nonce and audits roll back, and no
 *   JWS escapes. Public HTTP adapter separately owns input/auth/rate limits.
 * - No account/license-key identity is accepted from request claims.
 */
export async function issueAgentAccountProductLease(
  input: IssueAgentAccountProductLeaseInput,
  keyset: string | undefined,
  now = new Date(),
) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error("ACCOUNT_PRODUCT_LEASE_CLOCK_INVALID");

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
      const reason = verified.status === "denied"
        ? verified.reason : "INVALID_CHALLENGE" as const;
      await auditDeniedProductLeasePreparationInTransaction(tx, reason);
      return { status: "denied" as const, reason };
    }

    const prepared = await prepareAndAuditProductLeaseInTransaction(tx, {
      accessToken: input.accessToken,
      pepper: input.pepper,
      productId: input.productId,
      platform: input.platform,
      architecture: input.architecture,
      action: input.action,
      proof: verified.proof,
    }, now);
    if (prepared.status !== "ready_to_sign")
      return prepared;

    const claims = prepared.claims;
    const signed = await signAccountProductLeaseInTransaction(tx, claims, keyset);
    const jwsSha256 = createHash("sha256").update(signed.jws).digest("hex");

    // Durably audit ISSUED before the DB commit, but NEVER store JWS, the
    // private PEM, bearer, pepper, nonce or PoP signature in audit metadata.
    await tx.auditLog.create({
      data: {
        actorId: claims.userId,
        accountId: claims.accountId,
        action: "AGENT_PRODUCT_LEASE_ISSUED",
        targetType: "AgentProductLease",
        targetId: claims.leaseId,
        metadata: {
          schema: "bke.product-lease.issuance-audit.v1",
          kid: signed.kid,
          productId: claims.productId,
          action: claims.allowedActions[0],
          agentSessionId: claims.agentSessionId,
          agentKeyThumbprint: claims.agentKeyThumbprint,
          expiresAt: claims.expiresAt,
          jwsSha256,
        },
      },
    });

    return Object.freeze({
      status: "issued" as const,
      jws: signed.jws,
      kid: signed.kid,
      expiresAt: claims.expiresAt,
      refreshAfter: claims.refreshAfter,
    });
  }, { isolationLevel: "Serializable", timeout: 10_000 });
}

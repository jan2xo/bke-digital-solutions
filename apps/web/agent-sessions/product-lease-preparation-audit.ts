import "server-only";

import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import type { VerifiedAgentLeaseProof } from "./agent-key-proof-authority";
import { prepareVerifiedProductLeaseInTransaction } from "./product-lease-transaction-gate";

/**
 * SOURCE-ONLY authorization journal, NOT an execution-lease issuer.
 *
 * The caller owns a single SERIALIZABLE transaction spanning the consumed
 * cryptographic challenge, this live entitlement/key verification and audit.
 * Prepared claims remain unsigned and must never be sent to an Agent/product.
 * No private key, JWS, device code, nonce or bearer enters AuditLog.
 */
export async function prepareAndAuditProductLeaseInTransaction(
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
) {
  const result = await prepareVerifiedProductLeaseInTransaction(tx, input, now);

  if (result.status === "ready_to_sign") {
    // Only a successful server-owned gate may populate attribution. Never
    // attribute an unauthenticated denial to user/account fields in the request.
    const claims = result.claims;
    await tx.auditLog.create({
      data: {
        actorId: claims.userId,
        accountId: claims.accountId,
        action: "AGENT_PRODUCT_LEASE_PREPARED",
        targetType: "AgentProductLease",
        targetId: claims.leaseId,
        metadata: {
          schema: "bke.product-lease.preparation-audit.v1",
          productId: claims.productId,
          action: claims.allowedActions[0],
          agentSessionId: claims.agentSessionId,
          agentKeyThumbprint: claims.agentKeyThumbprint,
          expiresAt: claims.expiresAt,
        },
      },
    });
    return result;
  }

  // Preserve a denial breadcrumb without trusting a client product/account,
  // without storing bearer/pepper/PoP data and without forging attribution.
  await tx.auditLog.create({
    data: {
      actorId: null,
      accountId: null,
      action: "AGENT_PRODUCT_LEASE_PREPARATION_DENIED",
      targetType: "AgentProductLease",
      targetId: null,
      metadata: {
        schema: "bke.product-lease.preparation-audit.v1",
        reason: result.reason,
      },
    },
  });
  return result;
}

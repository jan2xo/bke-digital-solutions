import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { env } from "@/platform/host/env";
import { generateClaimCode, hashClaimCode, normalizeClaimCode, validClaimCode } from "./claim-code-material";

export type ClaimCodeIssueInput = Readonly<{
  orderId: string;
  orderItemId: string;
  purchaserAccountId: string;
  productId: string;
  editionId?: string | null;
  purchasePlanId?: string | null;
  resourceId: string;
  units: number;
  scopeSnapshot: unknown;
  grantSnapshot: unknown;
  validFrom: Date;
  validUntil?: Date | null;
  expiresAt?: Date | null;
}>;

export type ClaimCodeIssueResult =
  | { readonly status: "ISSUED"; readonly codes: readonly string[] }
  | { readonly status: "REJECTED"; readonly code: "INVALID_INPUT" | "ALREADY_ISSUED" };

export type ClaimCodeConsumeResult =
  | { readonly status: "CLAIMED"; readonly entitlementId: string; readonly accountId: string }
  | { readonly status: "REJECTED"; readonly code: "INVALID_CODE" | "ALREADY_CLAIMED" | "REVOKED" | "EXPIRED" };

type ClaimRow = Readonly<{
  id: string;
  status: "AVAILABLE" | "CLAIMED" | "REVOKED" | "EXPIRED";
  resourceId: string;
  productId: string;
  editionId: string | null;
  purchasePlanId: string | null;
  scopeSnapshot: unknown;
  grantSnapshot: unknown;
  validFrom: Date;
  validUntil: Date | null;
  expiresAt: Date | null;
  claimedToAccountId: string | null;
  entitlementId: string | null;
}>;

function validIssueInput(input: ClaimCodeIssueInput): boolean {
  return Boolean(
    input.orderId.trim()
    && input.orderItemId.trim()
    && input.purchaserAccountId.trim()
    && input.productId.trim()
    && input.resourceId.trim()
    && Number.isSafeInteger(input.units)
    && input.units > 0
    && input.units <= 1000
    && Number.isFinite(input.validFrom.getTime())
    && (!input.validUntil || input.validUntil > input.validFrom)
    && (!input.expiresAt || input.expiresAt > new Date(0)),
  );
}

export async function issueClaimCodes(
  tx: Prisma.TransactionClient,
  input: ClaimCodeIssueInput,
): Promise<ClaimCodeIssueResult> {
  if (!validIssueInput(input)) return { status: "REJECTED", code: "INVALID_INPUT" };

  const existing = await tx.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS "count"
      FROM "ClaimCode"
     WHERE "orderItemId" = ${input.orderItemId}
  `;
  if (Number(existing[0]?.count ?? 0n) > 0) {
    // Plaintext claim secrets are intentionally not persisted, so retries cannot
    // silently regenerate a different set of codes for the same paid item.
    return { status: "REJECTED", code: "ALREADY_ISSUED" };
  }

  const codes: string[] = [];
  for (let unitIndex = 0; unitIndex < input.units; unitIndex += 1) {
    const plaintext = generateClaimCode();
    const normalized = normalizeClaimCode(plaintext);
    const codeHash = hashClaimCode(normalized, env.LICENSE_PEPPER);
    await tx.$executeRaw`
      INSERT INTO "ClaimCode" (
        "id", "orderId", "orderItemId", "unitIndex", "purchaserAccountId",
        "codeHash", "codeLastFour", "status", "resourceId", "productId",
        "editionId", "purchasePlanId", "scopeSnapshot", "grantSnapshot",
        "validFrom", "validUntil", "expiresAt", "createdAt", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${input.orderId}, ${input.orderItemId}, ${unitIndex}, ${input.purchaserAccountId},
        ${codeHash}, ${normalized.slice(-4)}, 'AVAILABLE', ${input.resourceId}, ${input.productId},
        ${input.editionId ?? null}, ${input.purchasePlanId ?? null},
        ${JSON.stringify(input.scopeSnapshot ?? null)}::jsonb,
        ${JSON.stringify(input.grantSnapshot ?? null)}::jsonb,
        ${input.validFrom}, ${input.validUntil ?? null}, ${input.expiresAt ?? null}, NOW(), NOW()
      )
    `;
    codes.push(normalized);
  }

  return { status: "ISSUED", codes: Object.freeze(codes) };
}

export async function consumeClaimCode(
  tx: Prisma.TransactionClient,
  input: Readonly<{ code: string; userId: string; accountId: string }>,
): Promise<ClaimCodeConsumeResult> {
  if (!input.userId.trim() || !input.accountId.trim() || !validClaimCode(input.code)) {
    return { status: "REJECTED", code: "INVALID_CODE" };
  }

  const codeHash = hashClaimCode(input.code, env.LICENSE_PEPPER);
  const rows = await tx.$queryRaw<ClaimRow[]>`
    SELECT "id", "status", "resourceId", "productId", "editionId", "purchasePlanId",
           "scopeSnapshot", "grantSnapshot", "validFrom", "validUntil", "expiresAt",
           "claimedToAccountId", "entitlementId"
      FROM "ClaimCode"
     WHERE "codeHash" = ${codeHash}
     FOR UPDATE
  `;
  const claim = rows[0];
  if (!claim) return { status: "REJECTED", code: "INVALID_CODE" };
  if (claim.status === "CLAIMED") return { status: "REJECTED", code: "ALREADY_CLAIMED" };
  if (claim.status === "REVOKED") return { status: "REJECTED", code: "REVOKED" };

  const now = new Date();
  if (claim.status === "EXPIRED" || (claim.expiresAt && claim.expiresAt <= now)) {
    await tx.$executeRaw`
      UPDATE "ClaimCode"
         SET "status" = 'EXPIRED', "updatedAt" = NOW()
       WHERE "id" = ${claim.id} AND "status" = 'AVAILABLE'
    `;
    return { status: "REJECTED", code: "EXPIRED" };
  }

  const entitlementId = randomUUID();
  const sourceReference = `claim:${claim.id}`;
  const grantSnapshot = {
    ...(claim.grantSnapshot && typeof claim.grantSnapshot === "object" && !Array.isArray(claim.grantSnapshot)
      ? claim.grantSnapshot as Record<string, unknown>
      : { sourceGrant: claim.grantSnapshot ?? null }),
    source: "claim-code",
    claimCodeId: claim.id,
    claimedByUserId: input.userId,
    claimedToAccountId: input.accountId,
  };

  await tx.$executeRaw`
    INSERT INTO "Entitlement" (
      "id", "subjectId", "resourceId", "sourceReference", "status", "quantity",
      "scopeSnapshot", "grantSnapshot", "validFrom", "validUntil"
    ) VALUES (
      ${entitlementId}, ${input.accountId}, ${claim.resourceId}, ${sourceReference}, 'ACTIVE', 1,
      ${JSON.stringify(claim.scopeSnapshot ?? null)}::jsonb,
      ${JSON.stringify(grantSnapshot)}::jsonb,
      ${claim.validFrom}, ${claim.validUntil}
    )
  `;

  const changed = await tx.$executeRaw`
    UPDATE "ClaimCode"
       SET "status" = 'CLAIMED',
           "claimedAt" = NOW(),
           "claimedByUserId" = ${input.userId},
           "claimedToAccountId" = ${input.accountId},
           "entitlementId" = ${entitlementId},
           "updatedAt" = NOW()
     WHERE "id" = ${claim.id} AND "status" = 'AVAILABLE'
  `;
  if (changed !== 1) throw new Error("CLAIM_CODE_STATE_CHANGED");

  return { status: "CLAIMED", entitlementId, accountId: input.accountId };
}

import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { env } from "@/platform/host/env";
import { db } from "@/platform/host/db";
import { fulfillOrderLicensing } from "@/apps/web/licensing/entitlement-management";
import {
  claimRecipientMatches,
  normalizeClaimRecipientEmail,
  validClaimRecipientEmail,
} from "./claim-recipient-email";
import {
  decryptClaimCode,
  encryptClaimCode,
  generateClaimCode,
  hashClaimCode,
  normalizeClaimCode,
  validClaimCode,
} from "./claim-code-material";

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
  recipientEmail?: string | null;
}>;

export type ClaimCodeIssueResult =
  | {
      readonly status: "ISSUED" | "EXISTING";
      readonly unitCount: number;
      readonly claimCodeIds: readonly string[];
    }
  | { readonly status: "REJECTED"; readonly code: "INVALID_INPUT" | "SOURCE_CONFLICT" }
  | { readonly status: "FAILED"; readonly code: "DELIVERY_KEY_UNAVAILABLE" };

export type ClaimCodeRevealResult =
  | { readonly status: "AVAILABLE"; readonly code: string }
  | { readonly status: "REJECTED"; readonly code: "NOT_FOUND" | "ALREADY_CLAIMED" | "REVOKED" | "EXPIRED" }
  | { readonly status: "FAILED"; readonly code: "DELIVERY_KEY_UNAVAILABLE" | "INVALID_CIPHERTEXT" };

export type ClaimCodeConsumeResult =
  | { readonly status: "CLAIMED"; readonly entitlementId: string; readonly accountId: string }
  | { readonly status: "REJECTED"; readonly code: "INVALID_CODE" | "ALREADY_CLAIMED" | "REVOKED" | "EXPIRED" | "RECIPIENT_MISMATCH" };

type ClaimRow = Readonly<{
  id: string;
  orderId: string;
  orderItemId: string;
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
  recipientEmail: string | null;
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
    && (input.recipientEmail == null || validClaimRecipientEmail(input.recipientEmail))
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
  const deliveryKey = env.CLAIM_CODE_ENCRYPTION_KEY?.trim();
  if (!deliveryKey) return { status: "FAILED", code: "DELIVERY_KEY_UNAVAILABLE" };
  const recipientEmail = input.recipientEmail == null
    ? null
    : normalizeClaimRecipientEmail(input.recipientEmail);

  const existing = await tx.$queryRaw<Array<{
    id: string;
    orderId: string;
    unitIndex: number;
    purchaserAccountId: string;
    productId: string;
    editionId: string | null;
    purchasePlanId: string | null;
    resourceId: string;
    recipientEmail: string | null;
  }>>`
    SELECT "id", "orderId", "unitIndex", "purchaserAccountId", "productId",
           "editionId", "purchasePlanId", "resourceId", "recipientEmail"
      FROM "ClaimCode"
     WHERE "orderItemId" = ${input.orderItemId}
     ORDER BY "unitIndex" ASC
  `;
  if (existing.length > 0) {
    const sameSource =
      existing.length === input.units &&
      existing.every((row, index) =>
        row.orderId === input.orderId &&
        row.unitIndex === index &&
        row.purchaserAccountId === input.purchaserAccountId &&
        row.productId === input.productId &&
        row.editionId === (input.editionId ?? null) &&
        row.purchasePlanId === (input.purchasePlanId ?? null) &&
        row.resourceId === input.resourceId &&
        row.recipientEmail === recipientEmail
      );
    if (!sameSource) return { status: "REJECTED", code: "SOURCE_CONFLICT" };
    return {
      status: "EXISTING",
      unitCount: existing.length,
      claimCodeIds: Object.freeze(existing.map((row) => row.id)),
    };
  }

  const claimCodeIds: string[] = [];
  for (let unitIndex = 0; unitIndex < input.units; unitIndex += 1) {
    const plaintext = generateClaimCode();
    const normalized = normalizeClaimCode(plaintext);
    const codeHash = hashClaimCode(normalized, env.LICENSE_PEPPER);
    const codeCiphertext = encryptClaimCode(normalized, deliveryKey);
    const claimCodeId = randomUUID();
    await tx.$executeRaw`
      INSERT INTO "ClaimCode" (
        "id", "orderId", "orderItemId", "unitIndex", "purchaserAccountId",
        "codeHash", "codeCiphertext", "codeLastFour", "status", "resourceId", "productId",
        "editionId", "purchasePlanId", "scopeSnapshot", "grantSnapshot",
        "validFrom", "validUntil", "expiresAt", "recipientEmail", "createdAt", "updatedAt"
      ) VALUES (
        ${claimCodeId}, ${input.orderId}, ${input.orderItemId}, ${unitIndex}, ${input.purchaserAccountId},
        ${codeHash}, ${codeCiphertext}, ${normalized.slice(-4)}, 'AVAILABLE', ${input.resourceId}, ${input.productId},
        ${input.editionId ?? null}, ${input.purchasePlanId ?? null},
        ${JSON.stringify(input.scopeSnapshot ?? null)}::jsonb,
        ${JSON.stringify(input.grantSnapshot ?? null)}::jsonb,
        ${input.validFrom}, ${input.validUntil ?? null}, ${input.expiresAt ?? null},
        ${recipientEmail}, NOW(), NOW()
      )
    `;
    claimCodeIds.push(claimCodeId);
  }

  return {
    status: "ISSUED",
    unitCount: claimCodeIds.length,
    claimCodeIds: Object.freeze(claimCodeIds),
  };
}

export async function revealClaimCode(
  tx: Prisma.TransactionClient,
  input: Readonly<{ claimCodeId: string; purchaserAccountId: string }>,
): Promise<ClaimCodeRevealResult> {
  if (!input.claimCodeId.trim() || !input.purchaserAccountId.trim()) {
    return { status: "REJECTED", code: "NOT_FOUND" };
  }
  const rows = await tx.$queryRaw<Array<{
    id: string;
    status: "AVAILABLE" | "CLAIMED" | "REVOKED" | "EXPIRED";
    codeCiphertext: string | null;
    expiresAt: Date | null;
  }>>`
    SELECT "id", "status", "codeCiphertext", "expiresAt"
      FROM "ClaimCode"
     WHERE "id" = ${input.claimCodeId}
       AND "purchaserAccountId" = ${input.purchaserAccountId}
     LIMIT 1
  `;
  const claim = rows[0];
  if (!claim) return { status: "REJECTED", code: "NOT_FOUND" };
  if (claim.status === "CLAIMED") return { status: "REJECTED", code: "ALREADY_CLAIMED" };
  if (claim.status === "REVOKED") return { status: "REJECTED", code: "REVOKED" };

  if (claim.status === "EXPIRED" || (claim.expiresAt && claim.expiresAt <= new Date())) {
    await tx.$executeRaw`
      UPDATE "ClaimCode"
         SET "status" = 'EXPIRED', "codeCiphertext" = NULL, "updatedAt" = NOW()
       WHERE "id" = ${claim.id} AND "status" = 'AVAILABLE'
    `;
    return { status: "REJECTED", code: "EXPIRED" };
  }

  const deliveryKey = env.CLAIM_CODE_ENCRYPTION_KEY?.trim();
  if (!deliveryKey) return { status: "FAILED", code: "DELIVERY_KEY_UNAVAILABLE" };
  if (!claim.codeCiphertext) return { status: "FAILED", code: "INVALID_CIPHERTEXT" };
  try {
    return { status: "AVAILABLE", code: decryptClaimCode(claim.codeCiphertext, deliveryKey) };
  } catch {
    return { status: "FAILED", code: "INVALID_CIPHERTEXT" };
  }
}

export async function consumeClaimCode(
  tx: Prisma.TransactionClient,
  input: Readonly<{ code: string; userId: string; accountId: string; verifiedEmail: string }>,
): Promise<ClaimCodeConsumeResult> {
  if (
    !input.userId.trim()
    || !input.accountId.trim()
    || !validClaimRecipientEmail(input.verifiedEmail)
    || !validClaimCode(input.code)
  ) {
    return { status: "REJECTED", code: "INVALID_CODE" };
  }

  const codeHash = hashClaimCode(input.code, env.LICENSE_PEPPER);
  const rows = await tx.$queryRaw<ClaimRow[]>`
    SELECT "id", "orderId", "orderItemId", "status", "resourceId", "productId", "editionId", "purchasePlanId",
           "scopeSnapshot", "grantSnapshot", "validFrom", "validUntil", "expiresAt",
           "recipientEmail", "claimedToAccountId", "entitlementId"
      FROM "ClaimCode"
     WHERE "codeHash" = ${codeHash}
     FOR UPDATE
  `;
  const claim = rows[0];
  if (!claim) return { status: "REJECTED", code: "INVALID_CODE" };
  if (claim.status === "CLAIMED") return { status: "REJECTED", code: "ALREADY_CLAIMED" };
  if (claim.status === "REVOKED") return { status: "REJECTED", code: "REVOKED" };
  if (!claimRecipientMatches(claim.recipientEmail, input.verifiedEmail)) {
    return { status: "REJECTED", code: "RECIPIENT_MISMATCH" };
  }

  const now = new Date();
  if (claim.status === "EXPIRED" || (claim.expiresAt && claim.expiresAt <= now)) {
    await tx.$executeRaw`
      UPDATE "ClaimCode"
         SET "status" = 'EXPIRED', "codeCiphertext" = NULL, "updatedAt" = NOW()
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
    recipientBound: Boolean(claim.recipientEmail),
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

  await fulfillOrderLicensing(
    tx,
    claim.orderId,
    {},
    [],
    { accountId: input.accountId, orderItemId: claim.orderItemId },
  );

  const changed = await tx.$executeRaw`
    UPDATE "ClaimCode"
       SET "status" = 'CLAIMED',
           "claimedAt" = NOW(),
           "claimedByUserId" = ${input.userId},
           "claimedToAccountId" = ${input.accountId},
           "entitlementId" = ${entitlementId},
           "codeCiphertext" = NULL,
           "updatedAt" = NOW()
     WHERE "id" = ${claim.id} AND "status" = 'AVAILABLE'
  `;
  if (changed !== 1) throw new Error("CLAIM_CODE_STATE_CHANGED");

  return { status: "CLAIMED", entitlementId, accountId: input.accountId };
}


export type PendingRecipientClaim = Readonly<{
  claimCodeId: string;
  orderNumber: string;
  productName: string;
  editionName: string | null;
  planName: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}>;

export async function listPendingRecipientClaims(
  verifiedEmail: string,
): Promise<readonly PendingRecipientClaim[]> {
  if (!validClaimRecipientEmail(verifiedEmail)) return Object.freeze([]);
  const recipientEmail = normalizeClaimRecipientEmail(verifiedEmail);
  const rows = await db.$queryRaw<Array<{
    claimCodeId: string;
    orderNumber: string;
    productName: string;
    editionName: string | null;
    planName: string | null;
    createdAt: Date;
    expiresAt: Date | null;
  }>>`
    SELECT cc."id" AS "claimCodeId",
           o."number" AS "orderNumber",
           oi."productName",
           oi."editionName",
           oi."planName",
           cc."createdAt",
           cc."expiresAt"
      FROM "ClaimCode" cc
      JOIN "Order" o ON o."id" = cc."orderId"
      JOIN "OrderItem" oi ON oi."id" = cc."orderItemId"
     WHERE cc."recipientEmail" = ${recipientEmail}
       AND cc."status" = 'AVAILABLE'
       AND (cc."expiresAt" IS NULL OR cc."expiresAt" > NOW())
       AND o."status" = 'PAID'
     ORDER BY cc."createdAt" ASC
  `;
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

export async function consumeRecipientClaimById(
  tx: Prisma.TransactionClient,
  input: Readonly<{ claimCodeId: string; userId: string; accountId: string; verifiedEmail: string }>,
): Promise<ClaimCodeConsumeResult> {
  if (
    !input.claimCodeId.trim()
    || !input.userId.trim()
    || !input.accountId.trim()
    || !validClaimRecipientEmail(input.verifiedEmail)
  ) {
    return { status: "REJECTED", code: "INVALID_CODE" };
  }

  const recipientEmail = normalizeClaimRecipientEmail(input.verifiedEmail);
  const rows = await tx.$queryRaw<Array<{
    id: string;
    status: "AVAILABLE" | "CLAIMED" | "REVOKED" | "EXPIRED";
    recipientEmail: string | null;
    codeCiphertext: string | null;
    expiresAt: Date | null;
  }>>`
    SELECT "id", "status", "recipientEmail", "codeCiphertext", "expiresAt"
      FROM "ClaimCode"
     WHERE "id" = ${input.claimCodeId}
     LIMIT 1
  `;
  const claim = rows[0];
  if (!claim) return { status: "REJECTED", code: "INVALID_CODE" };
  if (claim.status === "CLAIMED") return { status: "REJECTED", code: "ALREADY_CLAIMED" };
  if (claim.status === "REVOKED") return { status: "REJECTED", code: "REVOKED" };
  if (!claimRecipientMatches(claim.recipientEmail, recipientEmail)) {
    return { status: "REJECTED", code: "RECIPIENT_MISMATCH" };
  }
  if (claim.status === "EXPIRED" || (claim.expiresAt && claim.expiresAt <= new Date())) {
    return { status: "REJECTED", code: "EXPIRED" };
  }

  const deliveryKey = env.CLAIM_CODE_ENCRYPTION_KEY?.trim();
  if (!deliveryKey || !claim.codeCiphertext) throw new Error("CLAIM_CODE_DELIVERY_UNAVAILABLE");
  const code = decryptClaimCode(claim.codeCiphertext, deliveryKey);
  return consumeClaimCode(tx, {
    code,
    userId: input.userId,
    accountId: input.accountId,
    verifiedEmail: recipientEmail,
  });
}

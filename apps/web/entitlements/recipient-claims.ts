import "server-only";

import { db } from "@/platform/host/db";
import {
  normalizeClaimRecipientEmail,
  validClaimRecipientEmail,
} from "./claim-recipient-email";

export type PendingRecipientClaim = Readonly<{
  id: string;
  productName: string;
  editionName: string | null;
  planType: "PERPETUAL" | "MONTHLY" | "ANNUAL" | null;
  expiresAt: Date | null;
  createdAt: Date;
}>;

export async function listPendingRecipientClaims(
  verifiedEmail: string,
): Promise<readonly PendingRecipientClaim[]> {
  if (!validClaimRecipientEmail(verifiedEmail)) return Object.freeze([]);
  const email = normalizeClaimRecipientEmail(verifiedEmail);

  const rows = await db.$queryRaw<PendingRecipientClaim[]>`
    SELECT c."id",
           p."name" AS "productName",
           e."name" AS "editionName",
           pp."type"::text AS "planType",
           c."expiresAt",
           c."createdAt"
      FROM "ClaimCode" c
      JOIN "Product" p ON p."id" = c."productId"
      LEFT JOIN "Edition" e ON e."id" = c."editionId"
      LEFT JOIN "PurchasePlan" pp ON pp."id" = c."purchasePlanId"
     WHERE c."recipientEmail" = ${email}
       AND c."status" = 'AVAILABLE'
       AND (c."expiresAt" IS NULL OR c."expiresAt" > NOW())
     ORDER BY c."createdAt" ASC, c."id" ASC
  `;
  return Object.freeze(rows.map((row) => Object.freeze({
    ...row,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    createdAt: new Date(row.createdAt),
  })));
}

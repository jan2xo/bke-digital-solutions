import "server-only";

import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { authenticateAgentAccessToken } from "./device-authorization";
import { readAgentSoftwareCatalog } from "@/apps/web/catalog/agent-software-catalog";
import { allowsProductActivation } from "@/apps/web/licensing/product-activation-mode";
import {
  evaluateProductLeaseEligibility,
  type ProductLeaseAction,
  type ProductLeaseEvidence,
  type ProductLeaseEligibilityDecision,
} from "./product-lease-eligibility-policy";

export type AgentProductLeaseEligibilityResult =
  | ProductLeaseEligibilityDecision
  | Readonly<{ status: "invalid_token" }>;

/**
 * Read-only, transaction-scoped DS eligibility fraction. The authenticated
 * Agent token fixes the account/user/session; callers CANNOT select them.
 * No public endpoint, no key loader, no JWS signer, no production activation.
 *
 * After @bke/licensing is immutably released a separate owner wave can use
 * this decision under a transaction to perform policy/issuance/audit.
 */
export async function checkAgentProductLeaseEligibilityInTransaction(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    accessToken: string;
    pepper: string;
    productId: string;
    platform: "windows" | "macos" | "linux";
    architecture: "x64" | "arm64" | "x86";
    action: ProductLeaseAction;
  }>,
  now = new Date(),
): Promise<AgentProductLeaseEligibilityResult> {
  const session = await authenticateAgentAccessToken(tx, {
    accessToken: input.accessToken,
    pepper: input.pepper,
  });
  if (session.status !== "authenticated") return { status: "invalid_token" };

  // Reuse current server-owned entitlement/release/seat visibility.
  // This is only an eligibility projection, NOT itself a signing authority.
  const catalog = await readAgentSoftwareCatalog(tx, {
    accountId: session.accountId,
    userId: session.userId,
    platform: input.platform,
    architecture: input.architecture,
  });
  const product = catalog.find(item => item.productId === input.productId);

  if (!product?.entitled || !product.installable || !product.executionType) {
    return { status: "denied", reason: "NOT_ENTITLED" };
  }

  // Account-based JWS eligibility MUST remain separate from the license-key
  // commercial lease path. Key-only products cannot satisfy this by providing
  // synthetic account/user/session IDs; the authenticated Agent identity above
  // is necessary but never sufficient.
  const productPolicy = await tx.$queryRaw<Array<{ activationMode: string }>>`
    SELECT COALESCE(policy."activationMode", 'EITHER') AS "activationMode"
      FROM "Product" product
      LEFT JOIN "ProductActivationPolicy" policy
        ON policy."productId" = product."id"
     WHERE product."productId" = ${input.productId}
     LIMIT 1
  `;
  if (productPolicy.length !== 1 ||
      !allowsProductActivation(productPolicy[0]!.activationMode, "ACCOUNT")) {
    return { status: "denied", reason: "NOT_ENTITLED" };
  }

  const rows = await readAccountProductLeaseEvidenceInTransaction(tx, {
    accountId: session.accountId,
    userId: session.userId,
    productId: input.productId,
    now,
  });


  return evaluateProductLeaseEligibility({
    sessionId: session.sessionId,
    accountId: session.accountId,
    userId: session.userId,
    productId: input.productId,
    action: input.action,
    now,
    productExists: true,
    productEntitled: product.entitled,
    productInstallable: product.installable,
    productExecutionType: product.executionType,
  }, rows);
}


/**
 * Internal source-evidence reader for one server-authorized account/product.
 * This is NOT an authorization decision or an HTTP entrypoint. The calling
 * server function MUST authenticate the Agent access token and enforce the
 * catalog gate before using these rows to produce any eligible decision.
 *
 * Exported solely to certify the actual PostgreSQL lineage of the newly
 * merged trial grants without fabricating an authenticated Agent session.
 */
export async function readAccountProductLeaseEvidenceInTransaction(
  tx: Prisma.TransactionClient,
  input: Readonly<{ accountId: string; userId: string; productId: string; now: Date }>,
): Promise<readonly ProductLeaseEvidence[]> {
  const rows = await tx.$queryRaw<Array<Omit<ProductLeaseEvidence, "rightSourceVerified">>>`
    SELECT e."id" AS "entitlementId",
           e."status"::text AS "entitlementStatus",
           e."validFrom" AS "entitlementValidFrom",
           e."validUntil" AS "entitlementValidUntil",
           l."id" AS "licenseId",
           l."status"::text AS "licenseStatus",
           l."expiresAt" AS "licenseExpiresAt",
           ca."type"::text AS "accountType",
           ca."ownerId" AS "accountOwnerId",
           ca."lifecycleState"::text AS "accountLifecycleState",
           l."maxSeats" AS "licenseMaxSeats",
           (la."id" IS NOT NULL) AS "seatAssigned",
           pp."type"::text AS "purchasePlanType",
           s."id" AS "subscriptionId",
           s."status"::text AS "subscriptionStatus",
           s."currentPeriodStart" AS "subscriptionPeriodStart",
           s."currentPeriodEnd" AS "subscriptionPeriodEnd",
           tg."id" AS "trialId",
           tg."trialStartsAt" AS "trialStartsAt",
           tg."trialEndsAt" AS "trialEndsAt",
           tg."revokedAt" AS "trialRevokedAt"
      FROM "Entitlement" e
      JOIN "CustomerAccount" ca ON ca."id" = e."subjectId"
      JOIN "Product" p ON p."productId" = ${input.productId}
      JOIN "License" l
        ON l."accountId" = ca."id" AND l."productId" = p."id"
      JOIN "OrderItem" item
        ON item."id" = l."orderItemId"
       AND item."orderId" = l."orderId"
       AND item."productId" = p."id"
      JOIN "Order" sourceOrder
        ON sourceOrder."id" = l."orderId"
       AND sourceOrder."status" = 'PAID'
      LEFT JOIN "LicenseAssignment" la
        ON la."licenseId" = l."id" AND la."userId" = ${input.userId}
      LEFT JOIN "ClaimCode" claim
        ON claim."entitlementId" = e."id"
       AND claim."status" = 'CLAIMED'
       AND claim."claimedToAccountId" = ca."id"
       AND claim."orderItemId" = l."orderItemId"
       AND claim."productId" = p."id"
       AND claim."orderId" = l."orderId"
       AND claim."purchaserAccountId" = sourceOrder."accountId"
       AND sourceOrder."fulfillmentMode" = 'CLAIM_CODE'
      LEFT JOIN "Subscription" s ON s."id" = l."subscriptionId"
      LEFT JOIN "TrialGrant" tg ON tg."licenseId" = l."id"
      LEFT JOIN "Edition" licenseEdition
        ON licenseEdition."id" = l."editionId"
       AND licenseEdition."productId" = p."id"
      LEFT JOIN "PurchasePlan" pp
        ON pp."id" = l."purchasePlanId"
       AND pp."editionId" = licenseEdition."id"
     WHERE ca."id" = ${input.accountId}
       AND (l."editionId" IS NULL OR licenseEdition."id" IS NOT NULL)
       AND (l."purchasePlanId" IS NULL OR pp."id" IS NOT NULL)
       AND (l."subscriptionId" IS NULL OR (
         s."id" IS NOT NULL
         AND s."accountId" = ca."id"
         AND s."productId" = p."id"
       ))
       AND (tg."id" IS NULL OR (
         tg."accountId" = ca."id"
         AND tg."productId" = p."id"
         AND tg."editionId" = l."editionId"
       ))
       AND (item."editionId" IS NULL OR item."editionId" = l."editionId")
       AND (item."purchasePlanId" IS NULL OR
         item."purchasePlanId" = l."purchasePlanId")
       AND e."status" = 'ACTIVE'
       AND e."validFrom" <= ${input.now}
       AND (e."validUntil" IS NULL OR e."validUntil" > ${input.now})
       AND (
         e."resourceId" = p."id"
         OR e."resourceId" = l."editionId"
       )
       AND (
         (sourceOrder."accountId" = ca."id"
          AND e."sourceReference" = ('commerce:' || l."orderId" || ':' || l."orderItemId"))
         OR (claim."id" IS NOT NULL
             AND e."sourceReference" = ('claim:' || claim."id"))
       )
     ORDER BY l."id", e."id"
     LIMIT 128
  `;
  return rows.map(row => ({ ...row, rightSourceVerified: true }));
}

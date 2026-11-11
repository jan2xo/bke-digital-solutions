import "server-only";

import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { authenticateAgentAccessToken } from "./device-authorization";
import { readAgentSoftwareCatalog } from "@/apps/web/catalog/agent-software-catalog";
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

  // Bind a matching durable entitlement to the same license source.
  // Direct rights come from that license's order item; claim-code rights must
  // target the same account, exact code and license order item.
  // Never combine an unrelated entitlement and unrelated license.
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
      LEFT JOIN "LicenseAssignment" la
        ON la."licenseId" = l."id" AND la."userId" = ${session.userId}
      LEFT JOIN "ClaimCode" claim
        ON claim."entitlementId" = e."id"
       AND claim."status" = 'CLAIMED'
       AND claim."claimedToAccountId" = ca."id"
       AND claim."orderItemId" = l."orderItemId"
      LEFT JOIN "Subscription" s ON s."id" = l."subscriptionId"
      LEFT JOIN "TrialGrant" tg ON tg."licenseId" = l."id"
      LEFT JOIN "PurchasePlan" pp ON pp."id" = l."purchasePlanId"
     WHERE ca."id" = ${session.accountId}
       AND e."status" = 'ACTIVE'
       AND e."validFrom" <= ${now}
       AND (e."validUntil" IS NULL OR e."validUntil" > ${now})
       AND (
         e."resourceId" = p."id"
         OR EXISTS (
           SELECT 1 FROM "Edition" edition
            WHERE edition."id" = e."resourceId"
              AND edition."productId" = p."id"
         )
       )
       AND (
         e."sourceReference" = ('commerce:' || l."orderId" || ':' || l."orderItemId")
         OR (claim."id" IS NOT NULL
             AND e."sourceReference" = ('claim:' || claim."id"))
       )
     ORDER BY l."id", e."id"
     LIMIT 128
  `;

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
  }, rows.map(row => ({ ...row, rightSourceVerified: true })));
}

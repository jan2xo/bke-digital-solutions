import "server-only";

import { db } from "@/platform/host/db";
import {
  purchaseConfirmationEmailEnabled,
  queueVerifiedPurchaseConfirmation,
} from "@/apps/web/email/purchase-confirmation";

type VerifiedPaidInvoice = Readonly<{
  id: string;
  fulfillmentMode: "ACCOUNT_ENTITLEMENT" | "CLAIM_CODE";
}>;

export type InvoiceEmailRecoverySummary = Readonly<{
  candidates: number;
  queued: number;
  alreadyQueued: number;
  notEligible: number;
  invalidRecipient: number;
}>;

const RECOVERY_LOOKBACK_MS = 48 * 60 * 60_000;
const RECOVERY_BATCH_LIMIT = 50;

/**
 * Recover an accidentally missing outbox entry, NOT a missing payment settlement.
 * Only settled, processed, provider-verified paid events are eligible. Payment
 * reconciliation and fulfillment stay exclusively under their existing owners.
 *
 * The bounded lookback avoids retroactively emailing years of purchases when
 * the opt-in email feature is first activated. The durable EmailOutbox retains
 * queued messages beyond this discovery window for normal retry/review.
 */
export async function recoverVerifiedPaidInvoiceEmails(
  input: Readonly<{ now?: Date; dryRun?: boolean }> = {},
): Promise<InvoiceEmailRecoverySummary> {
  const empty = Object.freeze({
    candidates: 0, queued: 0, alreadyQueued: 0, notEligible: 0, invalidRecipient: 0,
  });
  if (!purchaseConfirmationEmailEnabled()) return empty;
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("INVOICE_EMAIL_RECOVERY_TIME_INVALID");
  const since = new Date(now.getTime() - RECOVERY_LOOKBACK_MS);

  const candidates = await db.$queryRaw<VerifiedPaidInvoice[]>`
    SELECT o."id", o."fulfillmentMode"::text AS "fulfillmentMode"
      FROM "Order" o
      JOIN "Invoice" i ON i."orderId" = o."id"
     WHERE o."status" = 'PAID'
       AND i."status" = 'FINAL'
       AND o."paidAt" IS NOT NULL
       AND o."paidAt" >= ${since}
       AND o."paidAt" <= ${now}
       AND o."fulfillmentMode"::text IN ('ACCOUNT_ENTITLEMENT', 'CLAIM_CODE')
       AND NOT EXISTS (
         SELECT 1 FROM "EmailOutbox" e
          WHERE e."deduplicationKey" = 'purchase-confirmed:' || o."id"
       )
       AND EXISTS (
         SELECT 1 FROM "WebhookEvent" w
         JOIN "PaymentSettlementFact" s ON s."providerEventRecordId" = w."id"
         JOIN "Payment" p ON p."orderId" = o."id"
                         AND p."provider" = s."provider"
                         AND p."externalId" = s."externalPaymentId"
          WHERE w."orderId" = o."id"
            AND w."eventType" = 'payment.paid'
            AND w."status" = 'PROCESSED'
            AND w."resolutionStatus" = 'RESOLVED'
            AND w."provider" = s."provider"
            AND w."livemode" = s."livemode"
            AND p."status" = 'PAID'
            AND s."commercialReference" IN (o."id", o."number")
            AND s."amountMinor" = o."totalMinor"
            AND s."currency" = o."currency"
       )
     ORDER BY o."paidAt" ASC, o."id" ASC
     LIMIT ${RECOVERY_BATCH_LIMIT}
  `;

  if (input.dryRun) return { ...empty, candidates: candidates.length };

  const summary = { ...empty, candidates: candidates.length };
  for (const candidate of candidates) {
    // Do not infer SELF versus GIFT from pricing or webhook payload.
    if (candidate.fulfillmentMode !== "ACCOUNT_ENTITLEMENT" &&
        candidate.fulfillmentMode !== "CLAIM_CODE") {
      summary.notEligible += 1;
      continue;
    }
    const result = await db.$transaction((tx) => queueVerifiedPurchaseConfirmation(tx, {
      orderId: candidate.id,
      fulfillmentMode: candidate.fulfillmentMode,
    }));
    if (result === "QUEUED") summary.queued += 1;
    else if (result === "ALREADY_QUEUED") summary.alreadyQueued += 1;
    else if (result === "INVALID_RECIPIENT") summary.invalidRecipient += 1;
    else summary.notEligible += 1;
  }
  return summary;
}

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const webhookSource = readFileSync("lib/webhooks.ts", "utf8");
const ingestionSource = readFileSync("v2/apps/web/payments/webhook-ingestion.ts", "utf8");
const payMongoSource = readFileSync(
  "node_modules/@bke/payments/providers/paymongo/paymongo-adapter.ts",
  "utf8",
);

describe("payment webhook owner-adoption parity", () => {
  it("locks provider-mode and commercial matching precedence", () => {
    expect(webhookSource).toContain('PAYMONGO_LIVEMODE === "true"');
    expect(webhookSource).toContain('PAYMENT_MODE_MISMATCH');
    expect(webhookSource).toContain('PAYMENT_CHECKOUT_MISMATCH');
    expect(webhookSource).toContain('PAYMENT_REFERENCE_MISMATCH');
    expect(webhookSource).toContain('PAYMENT_AMOUNT_MISMATCH');
    expect(webhookSource).toContain('PAYMENT_CURRENCY_MISMATCH');
  });

  it("locks the known-payment missing-currency exception to refund.updated only", () => {
    expect(webhookSource).toContain('event.type !== "payment.refund.updated" || !knownPayment');
  });

  it("locks provider normalization of the legacy payment.refunded event", () => {
    expect(payMongoSource).toContain('rawType === "payment.refunded"');
    expect(payMongoSource).toContain('? "payment.refunded"');
  });

  it("locks settlement event branches and unknown-event acknowledgement", () => {
    expect(webhookSource).toContain('event.type === "payment.paid"');
    expect(webhookSource).toContain('event.type === "payment.failed"');
    expect(webhookSource).toContain('event.type === "payment.refund.updated" && event.refundStatus !== "succeeded"');
    expect(webhookSource).toContain('event.type === "unknown"');
    expect(webhookSource).toContain('PAYMENT_EVENT_UNSUPPORTED');
  });

  it("locks host-owned cross-domain orchestration around owner decisions", () => {
    expect(webhookSource).toContain('db.$transaction');
    expect(webhookSource).toContain('isolationLevel: "Serializable"');
    expect(webhookSource).toContain('issueEntitlements');
    expect(webhookSource).toContain('queueCommerceEmail');
    expect(webhookSource).toContain('issueCommercialLease');
    expect(webhookSource).toContain('dispatchEmailOutbox');
  });

  it("locks ingestion idempotency and replay-conflict semantics", () => {
    expect(ingestionSource).toContain('skipDuplicates: true');
    expect(ingestionSource).toContain('PAYMENT_EVENT_REPLAY_CONFLICT');
    expect(ingestionSource).toContain('result.disposition === "EXISTING"');
    expect(ingestionSource).toContain('processingAttempts: { increment: 1 }');
  });
});

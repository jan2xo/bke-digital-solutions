import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
  enabled: vi.fn(),
  queue: vi.fn(),
}));

vi.mock("@/platform/host/db", () => ({
  db: { $queryRaw: mocks.query, $transaction: mocks.transaction },
}));
vi.mock("@/apps/web/email/purchase-confirmation", () => ({
  purchaseConfirmationEmailEnabled: mocks.enabled,
  queueVerifiedPurchaseConfirmation: mocks.queue,
}));

import { recoverVerifiedPaidInvoiceEmails } from "@/apps/web/email/purchase-confirmation-recovery";

const now = new Date("2026-11-10T10:00:00Z");
const self = { id: "paid-self", fulfillmentMode: "ACCOUNT_ENTITLEMENT" };
const gift = { id: "paid-gift", fulfillmentMode: "CLAIM_CODE" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.query.mockResolvedValue([self, gift]);
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({ source: "isolated-test" }));
  mocks.queue.mockResolvedValue("QUEUED");
});

describe("cron recovery of verified paid invoice email", () => {
  it("is completely disabled until the purchase-confirmation activation gate is opened", async () => {
    mocks.enabled.mockReturnValue(false);
    expect(await recoverVerifiedPaidInvoiceEmails({ now })).toMatchObject({ candidates: 0, queued: 0 });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("requires provider-verified settled payment + processed webhook + FINAL invoice and bounds history", async () => {
    await recoverVerifiedPaidInvoiceEmails({ now, dryRun: true });
    const [fragments, since, until, limit] = mocks.query.mock.calls[0] as [string[], Date, Date, number];
    const sql = fragments.join("?");
    for (const boundary of [
      '"PaymentSettlementFact"', '"WebhookEvent"', '"Payment"', "'payment.paid'",
      "'PROCESSED'", "'RESOLVED'", "'PAID'", "'FINAL'",
      '"providerEventRecordId"', '"commercialReference"', '"amountMinor"',
      '"currency"', '"livemode"', '"fulfillmentMode"', '"deduplicationKey"',
    ]) expect(sql).toContain(boundary);
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("ORDER BY");
    expect(since.toISOString()).toBe("2026-11-08T10:00:00.000Z");
    expect(until).toEqual(now);
    expect(limit).toBe(50);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("reuses the canonical buyer/invoice queue once for SELF and GIFT without deriving recipient from a webhook", async () => {
    expect(await recoverVerifiedPaidInvoiceEmails({ now })).toMatchObject({ candidates: 2, queued: 2 });
    expect(mocks.queue).toHaveBeenCalledTimes(2);
    expect(mocks.queue).toHaveBeenNthCalledWith(1, expect.anything(), {
      orderId: "paid-self", fulfillmentMode: "ACCOUNT_ENTITLEMENT",
    });
    expect(mocks.queue).toHaveBeenNthCalledWith(2, expect.anything(), {
      orderId: "paid-gift", fulfillmentMode: "CLAIM_CODE",
    });
    const source = readFileSync("apps/web/email/purchase-confirmation-recovery.ts", "utf8");
    expect(source).not.toContain("emailProvider.send");
    expect(source).not.toContain("dispatchEmailOutbox");
    expect(source).not.toContain("paymentProvider");
  });

  it("accounts for races, invalid recipient and finalized-order policy without requeueing duplicates", async () => {
    mocks.query.mockResolvedValue([self, gift, { ...self, id: "bad-mail" }, { ...self, id: "refunded" }]);
    mocks.queue
      .mockResolvedValueOnce("QUEUED")
      .mockResolvedValueOnce("ALREADY_QUEUED")
      .mockResolvedValueOnce("INVALID_RECIPIENT")
      .mockResolvedValueOnce("NOT_ELIGIBLE");
    const summary = await recoverVerifiedPaidInvoiceEmails({ now });
    expect(summary).toMatchObject({
      candidates: 4, queued: 1, alreadyQueued: 1, invalidRecipient: 1, notEligible: 1,
    });
  });

  it("refuses unknown fulfillment modes and invalid clock without inventing an email or payment", async () => {
    mocks.query.mockResolvedValue([{ id: "unrecognized", fulfillmentMode: "UNKNOWN" }]);
    expect(await recoverVerifiedPaidInvoiceEmails({ now })).toMatchObject({ candidates: 1, notEligible: 1 });
    expect(mocks.transaction).not.toHaveBeenCalled();
    await expect(recoverVerifiedPaidInvoiceEmails({ now: new Date(NaN) }))
      .rejects.toThrow("INVOICE_EMAIL_RECOVERY_TIME_INVALID");
  });

  it("propagates database failures for scheduler retry rather than falsely reporting success", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("DB_DOWN"));
    await expect(recoverVerifiedPaidInvoiceEmails({ now })).rejects.toThrow("DB_DOWN");
  });

  it("wires discovery before dispatch in protected email scheduler, retaining the cron and activation locks", () => {
    const scheduler = readFileSync("apps/web/scheduler/handlers.ts", "utf8");
    const worker = readFileSync("workers/entry.ts", "utf8");
    const webhooks = readFileSync("apps/web/payments/webhook-processing.ts", "utf8");
    expect(scheduler.indexOf("recoverVerifiedPaidInvoiceEmails(")).toBeLessThan(scheduler.indexOf("dispatchEmailOutbox(100)"));
    expect(scheduler).toContain("dryRun: context.dryRun");
    expect(worker).toContain('EMAIL_OUTBOX_CRON_ENABLED');
    expect(webhooks).toContain("await queueVerifiedPurchaseConfirmation(tx");
    expect(webhooks).not.toContain("dispatchEmailOutbox");
  });
});

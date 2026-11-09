import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  purchaseConfirmationEmailEnabled,
  queueVerifiedPurchaseConfirmation,
  renderPurchaseConfirmationEmail,
  PURCHASE_CONFIRMATION_TYPE,
} from "@/apps/web/email/purchase-confirmation";

afterEach(() => vi.unstubAllEnvs());

function paidOrder() {
  return {
    id: "order-1", number: "BKE-2026-001", status: "PAID",
    currency: "PHP", totalMinor: 100, renewalSubscriptionId: null as string | null,
    account: { billingEmail: "buyer@example.invalid" },
    invoice: { id: "invoice_123", number: "INV-2026-001", status: "FINAL", currency: "PHP", totalMinor: 100 },
    items: [{ productName: "Render Dock", editionName: "Professional", planName: "Monthly", quantity: 1 }],
  };
}
type Order = ReturnType<typeof paidOrder>;
function fixture(order: Order | null = paidOrder()) {
  const findUnique = vi.fn(async (_input: unknown) => order);
  const createMany = vi.fn(async (_input: unknown) => ({ count: 1 }));
  return { tx: { order: { findUnique }, emailOutbox: { createMany } } as never, findUnique, createMany };
}
function requestAt(mock: ReturnType<typeof fixture>["createMany"], index = 0) {
  return mock.mock.calls[index]?.[0] as {
    skipDuplicates: boolean;
    data: { type: string; recipient: string; subject: string; deduplicationKey: string; payload: Record<string, unknown> }[];
  };
}
const payload = {
  orderId: "order-1", orderNumber: "BKE-2026-001", invoiceId: "invoice_123",
  invoiceNumber: "INV-2026-001", currency: "PHP", totalMinor: 100,
  kind: "SELF", items: [{ productName: "Render Dock", editionName: "Professional", planName: "Monthly", quantity: 1 }],
};

describe("opt-in verified purchase confirmation", () => {
  it("is disabled by default and never touches the transaction", async () => {
    vi.stubEnv("PURCHASE_CONFIRMATION_EMAIL_ENABLED", "");
    const { tx, findUnique, createMany } = fixture();
    expect(purchaseConfirmationEmailEnabled()).toBe(false);
    expect(await queueVerifiedPurchaseConfirmation(tx, {
      orderId: "order-1", fulfillmentMode: "ACCOUNT_ENTITLEMENT",
    })).toBe("DISABLED");
    expect(findUnique).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("queues canonical order, FINAL invoice, buyer billing address and one order-scoped key", async () => {
    const { tx, createMany } = fixture();
    expect(await queueVerifiedPurchaseConfirmation(tx, {
      orderId: "order-1", fulfillmentMode: "ACCOUNT_ENTITLEMENT", enabled: true,
    })).toBe("QUEUED");
    const req = requestAt(createMany);
    expect(req.skipDuplicates).toBe(true);
    expect(req.data[0]).toMatchObject({
      type: PURCHASE_CONFIRMATION_TYPE,
      recipient: "buyer@example.invalid",
      deduplicationKey: "purchase-confirmed:order-1",
      payload: { invoiceId: "invoice_123", kind: "SELF", currency: "PHP", totalMinor: 100 },
    });
    expect(JSON.stringify(req)).not.toMatch(/claimCode|licenseKey|keyCiphertext/);
  });

  it("returns already queued for idempotent replay (persistent outbox key is unique)", async () => {
    const { tx, createMany } = fixture();
    createMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await queueVerifiedPurchaseConfirmation(tx, {
      orderId: "order-1", fulfillmentMode: "ACCOUNT_ENTITLEMENT", enabled: true,
    })).toBe("QUEUED");
    expect(await queueVerifiedPurchaseConfirmation(tx, {
      orderId: "order-1", fulfillmentMode: "ACCOUNT_ENTITLEMENT", enabled: true,
    })).toBe("ALREADY_QUEUED");
    expect(requestAt(createMany).data[0].deduplicationKey).toEqual(requestAt(createMany, 1).data[0].deduplicationKey);
    expect(readFileSync("prisma/schema.prisma", "utf8")).toContain("deduplicationKey String?   @unique");
  });

  it("never queues failed/cancelled/refunded, draft, inconsistent or unfulfilled orders", async () => {
    const base = paidOrder();
    const variants: Order[] = [
      { ...base, status: "REFUNDED" }, { ...base, status: "CANCELLED" },
      { ...base, status: "PENDING" },
      { ...base, invoice: { ...base.invoice, status: "DRAFT" } },
      { ...base, invoice: { ...base.invoice, totalMinor: 999 } },
      { ...base, invoice: null as never },
      { ...base, items: [] },
    ];
    for (const variant of variants) {
      const { tx, createMany } = fixture(variant);
      expect(await queueVerifiedPurchaseConfirmation(tx, {
        orderId: "order-1", fulfillmentMode: "ACCOUNT_ENTITLEMENT", enabled: true,
      })).toBe("NOT_ELIGIBLE");
      expect(createMany).not.toHaveBeenCalled();
    }
  });

  it("refuses an invalid account billing address without failing delivery or using a webhook email", async () => {
    const { tx, createMany } = fixture({ ...paidOrder(), account: { billingEmail: "invalid\\r\\nBcc:attacker@example.invalid" } });
    expect(await queueVerifiedPurchaseConfirmation(tx, {
      orderId: "order-1", fulfillmentMode: "ACCOUNT_ENTITLEMENT", enabled: true,
    })).toBe("INVALID_RECIPIENT");
    expect(createMany).not.toHaveBeenCalled();
  });

  it("handles gift and renewal transactions without disclosing codes or keys", async () => {
    const gift = fixture();
    await queueVerifiedPurchaseConfirmation(gift.tx, { orderId: "order-1", fulfillmentMode: "CLAIM_CODE", enabled: true });
    expect(requestAt(gift.createMany).data[0].payload.kind).toBe("GIFT");
    const renewal = fixture({ ...paidOrder(), renewalSubscriptionId: "subscription-1" });
    await queueVerifiedPurchaseConfirmation(renewal.tx, { orderId: "order-1", fulfillmentMode: "ACCOUNT_ENTITLEMENT", enabled: true });
    expect(requestAt(renewal.createMany).data[0].payload.kind).toBe("RENEWAL");
    expect(renderPurchaseConfirmationEmail({ ...payload, kind: "GIFT" }, "https://bke.example.invalid")).toContain("Claim Code");
  });

  it("renders invoice and BKE links from trusted application origin, never payload links", () => {
    const text = renderPurchaseConfirmationEmail(payload, "https://bke.example.invalid");
    expect(text).toContain("₱1.00");
    expect(text).toContain("Render Dock — Professional (Monthly)");
    expect(text).toContain("https://bke.example.invalid/dashboard/invoices/invoice_123");
    expect(text).toContain("https://bke.example.invalid/bke");
    expect(text).not.toMatch(/keyCiphertext|licenseKey|claimCode/);
    expect(() => renderPurchaseConfirmationEmail(payload, "http://attacker.example.invalid")).toThrow("PURCHASE_EMAIL_APP_URL_INVALID");
    expect(() => renderPurchaseConfirmationEmail(payload, "https://user:secret@bke.example.invalid")).toThrow("PURCHASE_EMAIL_APP_URL_INVALID");
  });

  it("proves webhook queue only after fulfillment and dispatch only from the gated outbox", () => {
    const webhook = readFileSync("apps/web/payments/webhook-processing.ts", "utf8");
    const email = readFileSync("apps/web/email.ts", "utf8");
    const scheduler = readFileSync("apps/web/scheduler/handlers.ts", "utf8");
    expect(webhook.indexOf("await queueVerifiedPurchaseConfirmation(tx")).toBeGreaterThan(webhook.indexOf("await fulfillOrderLicensing("));
    expect(webhook).toContain('settlement.paymentSettlementDisposition === "CREATED"');
    expect(webhook).not.toContain("dispatchEmailOutbox");
    expect(email).toContain("purchaseConfirmationEmailEnabled()");
    expect(email).toContain("PURCHASE_CONFIRMATION_TYPE");
    expect(scheduler).toContain("purchaseConfirmationEmailEnabled()");
    expect(scheduler).toContain("PURCHASE_CONFIRMATION_TYPE");
    expect(scheduler).toContain('"PAYMENT_RECEIPT"');
  });
});

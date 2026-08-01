import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const secret = process.env.PAYMONGO_SECRET_KEY ?? "";
const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET ?? "";
const configured = process.env.PAYMENT_PROVIDER === "paymongo" && secret.startsWith("sk_test_") && webhookSecret.length > 0 && process.env.PAYMONGO_LIVEMODE === "false";
const sandbox = describe.skipIf(!configured);

sandbox("PayMongo sandbox contract", () => {
  it("creates a real hosted sandbox checkout without logging secrets or customer data", async () => {
    const logs = [vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const { PayMongoProvider } = await import("@/lib/payments/paymongo");
    const provider = new PayMongoProvider();
    const suffix = Date.now().toString(36);
    const checkout = await provider.createCheckout({
      orderId: `sandbox-${suffix}`, reference: `BKE-SANDBOX-${suffix}`, amountMinor: 10_000, currency: "PHP",
      customer: { name: "BKE Sandbox Check", email: "sandbox-checkout@bke.test" },
      items: [{ name: "BKE Sandbox Product", description: "Non-live integration verification", amountMinor: 10_000, quantity: 1 }],
      idempotencyKey: `sandbox-${suffix}`,
    });
    expect(checkout.externalId).toMatch(/^cs_/);
    expect(checkout.checkoutUrl).toMatch(/^https:\/\//);
    expect(logs.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    logs.forEach((spy) => spy.mockRestore());
  }, 30_000);

  it.skipIf(!process.env.PAYMONGO_SANDBOX_PAYMENT_ID)("retrieves and normalizes a real sandbox payment for reconciliation", async () => {
    const { PayMongoProvider } = await import("@/lib/payments/paymongo");
    const payment = await new PayMongoProvider().retrievePayment(process.env.PAYMONGO_SANDBOX_PAYMENT_ID!);
    expect(payment.externalId).toBe(process.env.PAYMONGO_SANDBOX_PAYMENT_ID);
    expect(payment.livemode).toBe(false);
    expect(payment.currency).toBe("PHP");
  }, 30_000);

  it.skipIf(!process.env.PAYMONGO_SANDBOX_WEBHOOK_PAYLOAD_FILE || !process.env.PAYMONGO_SANDBOX_WEBHOOK_SIGNATURE_FILE)("verifies and normalizes an unmodified real sandbox webhook", async () => {
    const [raw, signature] = await Promise.all([
      readFile(process.env.PAYMONGO_SANDBOX_WEBHOOK_PAYLOAD_FILE!),
      readFile(process.env.PAYMONGO_SANDBOX_WEBHOOK_SIGNATURE_FILE!, "utf8"),
    ]);
    const { PayMongoProvider } = await import("@/lib/payments/paymongo");
    const event = await new PayMongoProvider().verifyAndParseWebhook(raw, new Headers({ "paymongo-signature": signature.trim() }));
    expect(event.eventId).toMatch(/^evt_/);
    expect(event.livemode).toBe(false);
    expect(["payment.paid", "payment.failed", "payment.refunded", "unknown"]).toContain(event.type);
  });

  it.skipIf(!process.env.PAYMONGO_SANDBOX_WEBHOOK_PAYLOAD_FILE)("rejects a stale signature even for an exact sandbox payload", async () => {
    const raw = await readFile(process.env.PAYMONGO_SANDBOX_WEBHOOK_PAYLOAD_FILE!);
    const timestamp = Math.floor(Date.now() / 1000) - 301;
    const signature = createHmac("sha256", webhookSecret).update(`${timestamp}.${raw.toString("utf8")}`).digest("hex");
    const { PayMongoProvider } = await import("@/lib/payments/paymongo");
    await expect(new PayMongoProvider().verifyAndParseWebhook(raw, new Headers({ "paymongo-signature": `t=${timestamp},te=${signature}` }))).rejects.toThrow("INVALID_SIGNATURE");
  });

  it.skipIf(!process.env.PAYMONGO_SANDBOX_ORDER_ID)("reconciles a persisted sandbox payment with PayMongo", async () => {
    const { reconcilePayment } = await import("@/lib/reconciliation");
    const result = await reconcilePayment(process.env.PAYMONGO_SANDBOX_ORDER_ID!);
    expect(result).toMatchObject({ matched: true, differences: [] });
  }, 30_000);
});

describe("PayMongo sandbox safety gate", () => {
  it("never treats live credentials as sandbox credentials", () => {
    expect(configured && secret.startsWith("sk_live_")).toBe(false);
  });
});

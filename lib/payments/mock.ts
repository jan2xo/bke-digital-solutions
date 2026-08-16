import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import type { CheckoutInput, PaymentEvent, PaymentProvider } from "./types";
import type { RefundInput } from "./types";
import { PaymentLifecycleError } from "./errors";

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  async createCheckout(input: CheckoutInput) {
    return { externalId: `mock_${input.idempotencyKey}`, checkoutUrl: `${env.APP_URL}/checkout/mock?order=${encodeURIComponent(input.orderId)}&attempt=${encodeURIComponent(input.idempotencyKey)}` };
  }
  async verifyAndParseWebhook(raw: Buffer, headers: Headers): Promise<PaymentEvent> {
    if (process.env.NODE_ENV === "production") throw new Error("Mock provider is disabled in production");
    const signature = headers.get("x-mock-signature") ?? "";
    const expected = createHmac("sha256", env.SESSION_SECRET).update(raw).digest("hex");
    if (signature !== expected) throw new PaymentLifecycleError("PAYMENT_SIGNATURE_INVALID");
    const body = JSON.parse(raw.toString("utf8"));
    return { ...body, occurredAt: new Date(body.occurredAt) } as PaymentEvent;
  }
  async retrievePayment(externalId: string) { return { externalId, status: "pending" as const, amountMinor: 0, currency: "PHP", livemode: false }; }
  async createRefund(input: RefundInput) { return { externalId: `refund_${input.idempotencyKey.replace(/[^A-Za-z0-9]/g, "")}`, status: "pending" as const, amountMinor: input.amountMinor, paymentId: input.paymentId }; }
}

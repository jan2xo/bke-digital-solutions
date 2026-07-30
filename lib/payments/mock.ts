import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import type { CheckoutInput, PaymentEvent, PaymentProvider } from "./types";

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  async createCheckout(input: CheckoutInput) {
    return { externalId: `mock_${input.orderId}`, checkoutUrl: `${env.APP_URL}/checkout/mock?order=${encodeURIComponent(input.orderId)}` };
  }
  async verifyAndParseWebhook(raw: Buffer, headers: Headers): Promise<PaymentEvent> {
    if (env.NODE_ENV === "production") throw new Error("Mock provider is disabled in production");
    const signature = headers.get("x-mock-signature") ?? "";
    const expected = createHmac("sha256", env.SESSION_SECRET).update(raw).digest("hex");
    if (signature !== expected) throw new Error("INVALID_SIGNATURE");
    const body = JSON.parse(raw.toString("utf8"));
    return { ...body, occurredAt: new Date(body.occurredAt) } as PaymentEvent;
  }
}

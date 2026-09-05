import "server-only";

import { createPayMongoPaymentsAdapter } from "@bke/payments/providers/paymongo/paymongo-adapter";
import { resolvePayMongoConfiguration } from "@/v2/apps/web/providers/capability";

export type WebCheckoutInput = Readonly<{
  orderId: string;
  reference: string;
  amountMinor: number;
  currency: string;
  customer: Readonly<{ name: string; email: string }>;
  idempotencyKey: string;
  items: readonly Readonly<{
    name: string;
    description: string | null;
    amountMinor: number;
    quantity: number;
  }>[];
}>;

export type WebCheckoutResult = Readonly<{
  externalId: string;
  checkoutUrl: string;
}>;

function appOrigin(): string {
  const value = process.env.APP_URL?.trim();
  if (!value) throw new Error("APP_URL_REQUIRED");
  return new URL(value).origin;
}

function configuredProvider(): "mock" | "paymongo" {
  const value = process.env.PAYMENT_PROVIDER?.trim() || "mock";
  if (value !== "mock" && value !== "paymongo") throw new Error("V2_PAYMENT_PROVIDER_UNSUPPORTED");
  if (value === "mock" && process.env.NODE_ENV === "production") throw new Error("V2_MOCK_PAYMENTS_FORBIDDEN_IN_PRODUCTION");
  return value;
}

export const paymentProvider = Object.freeze({
  get name() {
    return configuredProvider();
  },

  async createCheckout(input: WebCheckoutInput): Promise<WebCheckoutResult> {
    const provider = configuredProvider();
    const origin = appOrigin();
    if (provider === "mock") {
      return {
        externalId: `mock_${input.idempotencyKey}`,
        checkoutUrl: `${origin}/checkout/success?order=${encodeURIComponent(input.orderId)}&mock=1`,
      };
    }

    const configuration = await resolvePayMongoConfiguration();
    const adapter = createPayMongoPaymentsAdapter({
      secretKey: configuration.secretKey,
      webhookSecret: configuration.webhookSecret,
      livemode: configuration.livemode,
      paymentMethodTypes: ["qrph"],
      successUrl: () => `${origin}/checkout/success?order=${encodeURIComponent(input.orderId)}`,
      cancelUrl: () => `${origin}/checkout/cancel?order=${encodeURIComponent(input.orderId)}`,
    });
    const checkout = await adapter.createCheckout({
      attemptId: input.idempotencyKey,
      sourceReference: input.orderId,
      commercialReference: input.reference,
      amountMinor: input.amountMinor,
      currency: input.currency,
      payer: input.customer,
      items: input.items,
      idempotencyKey: input.idempotencyKey,
    });
    return { externalId: checkout.externalCheckoutId, checkoutUrl: checkout.checkoutUrl };
  },
});

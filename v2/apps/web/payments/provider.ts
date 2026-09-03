import "server-only";
import { createPayMongoPaymentsAdapter } from "@bke/payments/providers/paymongo/paymongo-adapter";
import type { PaymentsCheckoutProvider } from "@bke/payments/logic/checkout-attempt-provider";
import type { PaymentsProviderEventVerifier } from "@bke/payments/logic/provider-event-verifier";
import type { PaymentsRefundProvider } from "@bke/payments/logic/refund-provider";

type WebPaymentsAdapter = PaymentsCheckoutProvider & PaymentsProviderEventVerifier & PaymentsRefundProvider;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing V2 web payments environment: ${name}`);
  return value;
}

function appOrigin() {
  return new URL(required("APP_URL")).origin;
}

function createMockAdapter(): WebPaymentsAdapter {
  if (process.env.NODE_ENV === "production") throw new Error("V2_MOCK_PAYMENTS_FORBIDDEN_IN_PRODUCTION");
  return Object.freeze({
    name: "mock",
    async createCheckout(input) {
      return {
        externalCheckoutId: `mock_${input.attemptId}`,
        checkoutUrl: `${appOrigin()}/checkout/success?order=${encodeURIComponent(input.commercialReference)}&mock=1`,
      };
    },
    async verifyAndParse() {
      throw new Error("V2_MOCK_PAYMENT_WEBHOOK_UNSUPPORTED");
    },
    async createRefund(input) {
      return {
        externalRefundId: `mock_refund_${input.idempotencyKey}`,
        status: "succeeded" as const,
        amountMinor: input.amountMinor,
        externalPaymentId: input.externalPaymentId,
      };
    },
  });
}

export function createWebPaymentsAdapter(): WebPaymentsAdapter {
  const source = process.env.PROVIDER_CONFIG_SOURCE?.trim() || "environment";
  if (source !== "environment") throw new Error("V2_DATABASE_PROVIDER_CONFIGURATION_NOT_MIGRATED");

  const provider = process.env.PAYMENT_PROVIDER?.trim() || "mock";
  if (provider === "mock") return createMockAdapter();
  if (provider !== "paymongo") throw new Error("V2_PAYMENT_PROVIDER_UNSUPPORTED");

  const livemode = process.env.PAYMONGO_LIVEMODE === "true";
  const origin = appOrigin();
  return createPayMongoPaymentsAdapter({
    secretKey: required("PAYMONGO_SECRET_KEY"),
    webhookSecret: required("PAYMONGO_WEBHOOK_SECRET"),
    livemode,
    paymentMethodTypes: ["qrph"],
    successUrl: (input) => `${origin}/checkout/success?order=${encodeURIComponent(input.commercialReference)}`,
    cancelUrl: (input) => `${origin}/checkout/cancel?order=${encodeURIComponent(input.commercialReference)}`,
  });
}

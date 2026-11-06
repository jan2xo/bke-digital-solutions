import "server-only";
import { createPayMongoPaymentsAdapter } from "@bke/payments/providers/paymongo/paymongo-adapter";
import { createPayMongoPaymentIntentAdapter } from "@bke/payments/providers/paymongo/paymongo-payment-intent-adapter";
import type { PaymentsPaymentIntentProvider } from "@bke/payments/logic/payment-intent-provider";
import type { PaymentsCheckoutProvider } from "@bke/payments/logic/checkout-attempt-provider";
import type { PaymentsProviderEventVerifier } from "@bke/payments/logic/provider-event-verifier";
import type { PaymentsReconciliationProvider } from "@bke/payments/logic/reconciliation-provider";
import type { PaymentsRefundProvider } from "@bke/payments/logic/refund-provider";
import { assertMockPaymentsAllowed } from "@/apps/web/payments/runtime-policy";

type WebPaymentsAdapter = PaymentsCheckoutProvider &
  PaymentsProviderEventVerifier &
  PaymentsRefundProvider &
  PaymentsReconciliationProvider;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing V2 web payments environment: ${name}`);
  return value;
}

function appOrigin() {
  return new URL(required("APP_URL")).origin;
}

function createMockAdapter(): WebPaymentsAdapter {
  assertMockPaymentsAllowed();
  const adapter: WebPaymentsAdapter = {
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
    async retrievePayment() {
      throw new Error("V2_MOCK_PAYMENT_RECONCILIATION_UNSUPPORTED");
    },
  };
  return Object.freeze(adapter);
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


/** Returns no Payment Intent provider until an optional public key is configured; mock/hosted-only operation needs no Payment Intent persistence. */
export function createWebPaymentIntentProvider(): PaymentsPaymentIntentProvider | undefined {
  const source = process.env.PROVIDER_CONFIG_SOURCE?.trim() || "environment";
  if (source !== "environment") throw new Error("V2_DATABASE_PROVIDER_CONFIGURATION_NOT_MIGRATED");

  const provider = process.env.PAYMENT_PROVIDER?.trim() || "mock";
  if (provider === "mock") {
    assertMockPaymentsAllowed();
    return undefined;
  }
  if (provider !== "paymongo") throw new Error("V2_PAYMENT_PROVIDER_UNSUPPORTED");

  const publicKey = process.env.PAYMONGO_PUBLIC_KEY?.trim();
  if (!publicKey) return undefined;

  const livemode = process.env.PAYMONGO_LIVEMODE === "true";
  return createPayMongoPaymentIntentAdapter({
    secretKey: required("PAYMONGO_SECRET_KEY"),
    publicKey,
    livemode,
    paymentMethodTypes: ["qrph"],
  });
}

import "server-only";

import { createHmac } from "node:crypto";
import type {
  PaymentsProviderEventVerifier,
  PaymentsVerifiedProviderEvent,
} from "@bke/payments/logic/provider-event-verifier";
import { createPayMongoPaymentsAdapter } from "@bke/payments/providers/paymongo/paymongo-adapter";
import { resolvePayMongoConfiguration } from "@/v2/apps/web/providers/capability";
import { env } from "@/v2/platform/host/env";

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

type ProviderEventRawBody = Parameters<PaymentsProviderEventVerifier["verifyAndParse"]>[0];
type ProviderEventHeaders = Parameters<PaymentsProviderEventVerifier["verifyAndParse"]>[1];

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

function headerValue(headers: Readonly<Record<string, string>>, name: string): string {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return "";
}

function mockEventVerifier(): PaymentsProviderEventVerifier {
  return Object.freeze({
    name: "mock",
    async verifyAndParse(rawBody: ProviderEventRawBody, headers: ProviderEventHeaders) {
      const signature = headerValue(headers, "x-mock-signature");
      const expected = createHmac("sha256", env.SESSION_SECRET).update(rawBody).digest("hex");
      if (signature !== expected) throw new Error("PAYMENT_SIGNATURE_INVALID");
      let body: Omit<PaymentsVerifiedProviderEvent, "occurredAt"> & { occurredAt: string };
      try {
        body = JSON.parse(Buffer.from(rawBody).toString("utf8")) as typeof body;
      } catch {
        throw new Error("PAYMENT_EVENT_INVALID");
      }
      return { ...body, occurredAt: new Date(body.occurredAt) };
    },
  });
}

async function payMongoAdapter() {
  const configuration = await resolvePayMongoConfiguration();
  return createPayMongoPaymentsAdapter({
    secretKey: configuration.secretKey,
    webhookSecret: configuration.webhookSecret,
    livemode: configuration.livemode,
    paymentMethodTypes: ["qrph"],
    successUrl: (input) => `${appOrigin()}/checkout/success?order=${encodeURIComponent(input.sourceReference)}`,
    cancelUrl: (input) => `${appOrigin()}/checkout/cancel?order=${encodeURIComponent(input.sourceReference)}`,
  });
}

export async function createPaymentEventVerifier(): Promise<PaymentsProviderEventVerifier> {
  return configuredProvider() === "mock" ? mockEventVerifier() : payMongoAdapter();
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

    const adapter = await payMongoAdapter();
    const checkout = await adapter.createCheckout({
      attemptId: input.idempotencyKey,
      sourceReference: input.orderId,
      commercialReference: input.reference,
      amountMinor: input.amountMinor,
      currency: input.currency,
      payer: input.customer,
      items: input.items.map((item) => ({
        name: item.name,
        ...(item.description === null ? {} : { description: item.description }),
        amountMinor: item.amountMinor,
        quantity: item.quantity,
      })),
      idempotencyKey: input.idempotencyKey,
    });
    return { externalId: checkout.externalCheckoutId, checkoutUrl: checkout.checkoutUrl };
  },
});

import "server-only";

import { createHmac } from "node:crypto";
import type { PaymentsVerifiedProviderEvent } from "@bke/payments/logic/provider-event-verifier";
import type { PaymentsProviderEventVerifier } from "@bke/payments/logic/provider-event-verifier";
import type { PaymentsProviderEventRepository } from "@bke/payments/logic/provider-event-repository";
import { createPaymentsProviderEventIngestionCapability } from "@bke/payments/logic/provider-event-ingestion";
import { PaymentLifecycleError } from "@bke/payments/logic/payment-errors";
import { createPayMongoPaymentsAdapter } from "@bke/payments/providers/paymongo/paymongo-adapter";
import { db } from "@/v2/platform/host/db";
import { env } from "@/v2/platform/host/env";
import { resolvePayMongoConfiguration } from "@/v2/apps/web/providers/capability";

type StoredProviderEvent = Readonly<{
  eventId: string;
  rawType?: string;
  type: PaymentsVerifiedProviderEvent["type"];
  externalPaymentId?: string;
  externalCheckoutId?: string;
  reference?: string;
  externalRefundId?: string;
  refundStatus?: PaymentsVerifiedProviderEvent["refundStatus"];
  amountMinor?: number;
  currency?: string;
  livemode: boolean;
  occurredAt: string;
  eventFingerprint?: string;
}>;

type VerifyRawBody = Parameters<PaymentsProviderEventVerifier["verifyAndParse"]>[0];
type VerifyHeaders = Parameters<PaymentsProviderEventVerifier["verifyAndParse"]>[1];
type ProviderEventClaimInput = Parameters<PaymentsProviderEventRepository["claim"]>[0];

function headerRecord(headers: Headers): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(headers.entries()));
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return "";
}

function mockVerifier(): PaymentsProviderEventVerifier {
  if (process.env.NODE_ENV === "production") throw new Error("V2_MOCK_PAYMENTS_FORBIDDEN_IN_PRODUCTION");
  return Object.freeze({
    name: "mock",
    async verifyAndParse(rawBody: VerifyRawBody, headers: VerifyHeaders) {
      const signature = headerValue(headers, "x-mock-signature");
      const expected = createHmac("sha256", env.SESSION_SECRET).update(rawBody).digest("hex");
      if (signature !== expected) throw new Error("PAYMENT_SIGNATURE_INVALID");
      const body = JSON.parse(Buffer.from(rawBody).toString("utf8")) as Omit<StoredProviderEvent, "occurredAt"> & { occurredAt: string };
      return { ...body, occurredAt: new Date(body.occurredAt) };
    },
  });
}

async function providerEventVerifier(): Promise<PaymentsProviderEventVerifier> {
  const provider = process.env.PAYMENT_PROVIDER?.trim() || "mock";
  if (provider === "mock") return mockVerifier();
  if (provider !== "paymongo") throw new Error("V2_PAYMENT_PROVIDER_UNSUPPORTED");

  const configuration = await resolvePayMongoConfiguration();
  const origin = new URL(env.APP_URL).origin;
  return createPayMongoPaymentsAdapter({
    secretKey: configuration.secretKey,
    webhookSecret: configuration.webhookSecret,
    livemode: configuration.livemode,
    paymentMethodTypes: ["qrph"],
    successUrl: (input) => `${origin}/checkout/success?order=${encodeURIComponent(input.commercialReference)}`,
    cancelUrl: (input) => `${origin}/checkout/cancel?order=${encodeURIComponent(input.commercialReference)}`,
  });
}

function storedEvent(input: ProviderEventClaimInput): StoredProviderEvent {
  return Object.freeze({
    eventId: input.eventId,
    ...(input.rawType ? { rawType: input.rawType } : {}),
    type: input.type,
    ...(input.externalPaymentId ? { externalPaymentId: input.externalPaymentId } : {}),
    ...(input.externalCheckoutId ? { externalCheckoutId: input.externalCheckoutId } : {}),
    ...(input.reference ? { reference: input.reference } : {}),
    ...(input.externalRefundId ? { externalRefundId: input.externalRefundId } : {}),
    ...(input.refundStatus ? { refundStatus: input.refundStatus } : {}),
    ...(input.amountMinor !== null ? { amountMinor: input.amountMinor } : {}),
    ...(input.currency ? { currency: input.currency } : {}),
    livemode: input.livemode,
    occurredAt: input.occurredAt.toISOString(),
    eventFingerprint: input.eventFingerprint,
  });
}

function storedFingerprint(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fingerprint = (value as { eventFingerprint?: unknown }).eventFingerprint;
  return typeof fingerprint === "string" && fingerprint.length > 0 ? fingerprint : null;
}

const repository: PaymentsProviderEventRepository = Object.freeze({
  async claim(input: ProviderEventClaimInput) {
    const inserted = await db.webhookEvent.createMany({
      data: [{
        id: input.id,
        provider: input.provider,
        externalEventId: input.eventId,
        rawEventType: input.rawType,
        eventType: input.type,
        livemode: input.livemode,
        payloadHash: input.payloadHash,
        normalizedData: storedEvent(input),
        status: "RECEIVED",
        occurredAt: input.occurredAt,
        processingAttempts: 1,
        lastAttemptAt: new Date(),
        providerCheckoutId: input.externalCheckoutId,
        providerPaymentId: input.externalPaymentId,
        providerRefundId: input.externalRefundId,
      }],
      skipDuplicates: true,
    });
    const row = await db.webhookEvent.findUniqueOrThrow({
      where: { provider_externalEventId: { provider: input.provider, externalEventId: input.eventId } },
    });
    const fingerprint = storedFingerprint(row.normalizedData)
      ?? (row.payloadHash === input.payloadHash ? input.eventFingerprint : "LEGACY_EVENT_FINGERPRINT_MISMATCH");
    return {
      created: inserted.count === 1,
      record: {
        id: row.id,
        provider: row.provider,
        eventId: row.externalEventId,
        payloadHash: row.payloadHash,
        eventFingerprint: fingerprint,
        rawType: row.rawEventType,
        type: input.type,
        externalPaymentId: row.providerPaymentId ?? input.externalPaymentId,
        externalCheckoutId: row.providerCheckoutId ?? input.externalCheckoutId,
        reference: input.reference,
        externalRefundId: row.providerRefundId ?? input.externalRefundId,
        refundStatus: input.refundStatus,
        amountMinor: input.amountMinor,
        currency: input.currency,
        livemode: row.livemode,
        occurredAt: row.occurredAt ?? input.occurredAt,
        receivedAt: row.receivedAt,
      },
    };
  },
});

function verificationError(error: unknown): PaymentLifecycleError {
  if (error instanceof PaymentLifecycleError) return error;
  if (error instanceof Error && error.message === "PAYMENT_SIGNATURE_STALE") {
    return new PaymentLifecycleError("PAYMENT_SIGNATURE_STALE");
  }
  if (error instanceof Error && error.message === "PAYMENT_SIGNATURE_INVALID") {
    return new PaymentLifecycleError("PAYMENT_SIGNATURE_INVALID");
  }
  return new PaymentLifecycleError("PAYMENT_PROCESSING_FAILED");
}

export async function ingestPaymentWebhook(raw: Buffer, headers: Headers): Promise<{
  event: PaymentsVerifiedProviderEvent;
  duplicate: boolean;
}> {
  const rawBody = new Uint8Array(raw);
  const normalizedHeaders = headerRecord(headers);
  const verifier = await providerEventVerifier();

  let event: PaymentsVerifiedProviderEvent;
  try {
    event = await verifier.verifyAndParse(rawBody, normalizedHeaders);
  } catch (error) {
    throw verificationError(error);
  }

  const capability = createPaymentsProviderEventIngestionCapability(repository, Object.freeze({
    name: verifier.name,
    async verifyAndParse() { return event; },
  }));
  const result = await capability.ingest({ rawBody, headers: normalizedHeaders });
  if (result.status === "REJECTED") {
    await db.webhookEvent.updateMany({
      where: { provider: verifier.name, externalEventId: event.eventId },
      data: { conflictCount: { increment: 1 }, lastErrorCode: "PAYMENT_EVENT_REPLAY_CONFLICT", resolutionStatus: "OPEN" },
    });
    throw new PaymentLifecycleError("PAYMENT_EVENT_REPLAY_CONFLICT");
  }
  if (result.status === "FAILED") {
    throw new PaymentLifecycleError(
      result.code === "PERSISTENCE_UNAVAILABLE" ? "PAYMENT_PROCESSING_RETRYABLE" : "PAYMENT_PROCESSING_FAILED",
      result.code === "PERSISTENCE_UNAVAILABLE",
    );
  }
  if (result.disposition === "EXISTING") {
    const existing = await db.webhookEvent.findUniqueOrThrow({
      where: { provider_externalEventId: { provider: verifier.name, externalEventId: event.eventId } },
      select: { id: true, status: true },
    });
    if (existing.status !== "FAILED") return { event, duplicate: true };
    await db.webhookEvent.update({
      where: { id: existing.id },
      data: {
        status: "RECEIVED",
        error: null,
        lastErrorCode: null,
        processedAt: null,
        processingAttempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
  }
  return { event, duplicate: false };
}

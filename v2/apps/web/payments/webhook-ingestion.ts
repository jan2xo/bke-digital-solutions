import "server-only";

import type { PaymentsVerifiedProviderEvent } from "@bke/payments/logic/provider-event-verifier";
import type { PaymentsProviderEventVerifier } from "@bke/payments/logic/provider-event-verifier";
import type { PaymentsProviderEventRepository } from "@bke/payments/logic/provider-event-repository";
import { createPaymentsProviderEventIngestionCapability } from "@bke/payments/logic/provider-event-ingestion";
import { PaymentLifecycleError } from "@bke/payments/logic/payment-errors";
import { createPaymentEventVerifier } from "@/v2/apps/web/payments/compatibility-provider";
import { db } from "@/v2/platform/host/db";

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

type ProviderEventClaimInput = Parameters<PaymentsProviderEventRepository["claim"]>[0];

function headerRecord(headers: Headers): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(headers.entries()));
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
  const verifier = await createPaymentEventVerifier();
  let verifiedEvent: PaymentsVerifiedProviderEvent | undefined;
  let verificationFailure: unknown;

  const capturingVerifier: PaymentsProviderEventVerifier = Object.freeze({
    name: verifier.name,
    async verifyAndParse(inputRawBody, inputHeaders) {
      try {
        const event = await verifier.verifyAndParse(inputRawBody, inputHeaders);
        verifiedEvent = event;
        return event;
      } catch (error) {
        verificationFailure = error;
        throw error;
      }
    },
  });

  const capability = createPaymentsProviderEventIngestionCapability(repository, capturingVerifier);
  const result = await capability.ingest({ rawBody, headers: normalizedHeaders });

  if (result.status === "REJECTED") {
    if (!verifiedEvent) throw new PaymentLifecycleError("PAYMENT_PROCESSING_FAILED");
    await db.webhookEvent.updateMany({
      where: { provider: verifier.name, externalEventId: verifiedEvent.eventId },
      data: { conflictCount: { increment: 1 }, lastErrorCode: "PAYMENT_EVENT_REPLAY_CONFLICT", resolutionStatus: "OPEN" },
    });
    throw new PaymentLifecycleError("PAYMENT_EVENT_REPLAY_CONFLICT");
  }

  if (result.status === "FAILED") {
    if (result.code === "VERIFICATION_FAILED" && verificationFailure) {
      throw verificationError(verificationFailure);
    }
    throw new PaymentLifecycleError(
      result.code === "PERSISTENCE_UNAVAILABLE" ? "PAYMENT_PROCESSING_RETRYABLE" : "PAYMENT_PROCESSING_FAILED",
      result.code === "PERSISTENCE_UNAVAILABLE",
    );
  }

  const event: PaymentsVerifiedProviderEvent = result.value;
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

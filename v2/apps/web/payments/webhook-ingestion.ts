import "server-only";

import type {
  PaymentsVerifiedProviderEventSnapshot,
} from "@bke/payments/contracts/provider-event-ingestion.contract";
import type { PaymentsVerifiedProviderEvent } from "@bke/payments/logic/provider-event-verifier";
import type { PaymentsProviderEventVerifier } from "@bke/payments/logic/provider-event-verifier";
import type {
  PaymentsProviderEventClaim,
  PaymentsProviderEventRecord,
  PaymentsProviderEventRepository,
} from "@bke/payments/logic/provider-event-repository";
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

type ProviderEventRow = Readonly<{
  id: string;
  provider: string;
  eventId: string;
  payloadHash: string;
  eventFingerprint: string;
  rawType: string | null;
  type: PaymentsProviderEventRecord["type"];
  externalPaymentId: string | null;
  externalCheckoutId: string | null;
  reference: string | null;
  externalRefundId: string | null;
  refundStatus: PaymentsProviderEventRecord["refundStatus"];
  amountMinor: number | null;
  currency: string | null;
  livemode: boolean;
  occurredAt: Date;
  receivedAt: Date;
}>;

type VerifyRawBody = Parameters<PaymentsProviderEventVerifier["verifyAndParse"]>[0];
type VerifyHeaders = Parameters<PaymentsProviderEventVerifier["verifyAndParse"]>[1];

function headerRecord(headers: Headers): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(headers.entries()));
}

function storedEvent(input: PaymentsProviderEventClaim): StoredProviderEvent {
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

function ownerRecord(row: ProviderEventRow): PaymentsProviderEventRecord {
  return Object.freeze({ ...row });
}

const repository: PaymentsProviderEventRepository = Object.freeze({
  async claim(input: PaymentsProviderEventClaim) {
    return db.$transaction(async (tx) => {
      const inserted = await tx.webhookEvent.createMany({
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
      const operational = await tx.webhookEvent.findUniqueOrThrow({
        where: {
          provider_externalEventId: {
            provider: input.provider,
            externalEventId: input.eventId,
          },
        },
      });
      const fingerprint = storedFingerprint(operational.normalizedData)
        ?? (operational.payloadHash === input.payloadHash
          ? input.eventFingerprint
          : "LEGACY_EVENT_FINGERPRINT_MISMATCH");

      await tx.$executeRaw`
        INSERT INTO "PaymentProviderEvent" (
          "id", "provider", "eventId", "payloadHash", "eventFingerprint", "rawType", "type",
          "externalPaymentId", "externalCheckoutId", "reference", "externalRefundId", "refundStatus",
          "amountMinor", "currency", "livemode", "occurredAt"
        ) VALUES (
          ${operational.id}, ${input.provider}, ${input.eventId}, ${operational.payloadHash}, ${fingerprint},
          ${input.rawType}, ${input.type}, ${input.externalPaymentId}, ${input.externalCheckoutId}, ${input.reference},
          ${input.externalRefundId}, ${input.refundStatus}, ${input.amountMinor}, ${input.currency},
          ${operational.livemode}, ${operational.occurredAt ?? input.occurredAt}
        )
        ON CONFLICT ("provider", "eventId") DO NOTHING
      `;
      const ownerRows = await tx.$queryRaw<ProviderEventRow[]>`
        SELECT "id", "provider", "eventId", "payloadHash", "eventFingerprint", "rawType", "type",
               "externalPaymentId", "externalCheckoutId", "reference", "externalRefundId", "refundStatus",
               "amountMinor", "currency", "livemode", "occurredAt", "receivedAt"
          FROM "PaymentProviderEvent"
         WHERE "provider" = ${input.provider} AND "eventId" = ${input.eventId}
         LIMIT 1
      `;
      if (!ownerRows[0]) throw new Error("PAYMENTS_PROVIDER_EVENT_DISAPPEARED");
      return {
        created: inserted.count === 1,
        record: ownerRecord(ownerRows[0]),
      };
    }, { isolationLevel: "Serializable" });
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
  event: PaymentsVerifiedProviderEventSnapshot;
  duplicate: boolean;
}> {
  const rawBody = new Uint8Array(raw);
  const normalizedHeaders = headerRecord(headers);
  const verifier = await createPaymentEventVerifier();
  let verifiedEvent: PaymentsVerifiedProviderEvent | undefined;
  let verificationFailure: unknown;

  const capturingVerifier: PaymentsProviderEventVerifier = Object.freeze({
    name: verifier.name,
    async verifyAndParse(inputRawBody: VerifyRawBody, inputHeaders: VerifyHeaders) {
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
      data: {
        conflictCount: { increment: 1 },
        lastErrorCode: "PAYMENT_EVENT_REPLAY_CONFLICT",
        resolutionStatus: "OPEN",
      },
    });
    throw new PaymentLifecycleError("PAYMENT_EVENT_REPLAY_CONFLICT");
  }

  if (result.status === "FAILED") {
    if (result.code === "VERIFICATION_FAILED" && verificationFailure) {
      throw verificationError(verificationFailure);
    }
    throw new PaymentLifecycleError(
      result.code === "PERSISTENCE_UNAVAILABLE"
        ? "PAYMENT_PROCESSING_RETRYABLE"
        : "PAYMENT_PROCESSING_FAILED",
      result.code === "PERSISTENCE_UNAVAILABLE",
    );
  }

  const event = result.value;
  if (result.disposition === "EXISTING") {
    const existing = await db.webhookEvent.findUniqueOrThrow({
      where: {
        provider_externalEventId: {
          provider: event.provider,
          externalEventId: event.eventId,
        },
      },
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

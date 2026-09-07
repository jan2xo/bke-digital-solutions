import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { dispatchEmailOutbox, queueCommerceEmail } from "@/lib/email";
import { issueEntitlements, type RenewalLeaseRequest } from "@/lib/licensing";
import { issueCommercialLease } from "@/v2/apps/web/licensing/commercial-lease";
import { decryptLicenseKey, sha256 } from "@/lib/security/crypto";
import { paymentProvider } from "@/lib/payments";
import { PaymentLifecycleError, safePaymentError } from "@bke/payments/logic/payment-errors";
import type { PaymentEvent } from "@/lib/payments/types";

type StoredEvent = Omit<PaymentEvent, "occurredAt"> & { occurredAt: string };
const normalizedData = (event: PaymentEvent): StoredEvent => ({ ...event, occurredAt: event.occurredAt.toISOString() });
const fromStored = (value: unknown): PaymentEvent => {
  const event = value as StoredEvent | null;
  if (!event?.eventId || !event.type || !event.occurredAt) throw new PaymentLifecycleError("PAYMENT_RECONCILIATION_REQUIRED");
  return { ...event, occurredAt: new Date(event.occurredAt) };
};

async function recordFailure(eventId: string, code: string, retryable: boolean) {
  await db.webhookEvent.update({
    where: { provider_externalEventId: { provider: paymentProvider.name, externalEventId: eventId } },
    data: { status: "FAILED", error: code, lastErrorCode: code, mismatchCategory: code.includes("MISMATCH") ? code : undefined, resolutionStatus: "OPEN", lastAttemptAt: new Date(), ...(retryable ? {} : { processedAt: null }) },
  });
}

async function resolveOrder(tx: Prisma.TransactionClient, event: PaymentEvent) {
  const attempt = event.externalCheckoutId ? await tx.paymentAttempt.findUnique({ where: { externalCheckoutId: event.externalCheckoutId }, include: { order: true } }) : null;
  const byReference = event.reference ? await tx.order.findUnique({ where: { number: event.reference } }) : null;
  const knownPayment = event.externalPaymentId ? await tx.payment.findUnique({ where: { provider_externalId: { provider: paymentProvider.name, externalId: event.externalPaymentId } }, include: { order: true } }) : null;
  if (event.externalCheckoutId && !attempt && !knownPayment) throw new PaymentLifecycleError("PAYMENT_CHECKOUT_MISMATCH");
  if (attempt && byReference && attempt.orderId !== byReference.id) throw new PaymentLifecycleError("PAYMENT_CHECKOUT_MISMATCH");
  const order = attempt?.order ?? byReference ?? knownPayment?.order;
  if (!order) throw new PaymentLifecycleError("PAYMENT_REFERENCE_MISMATCH");
  if (knownPayment && knownPayment.orderId !== order.id) throw new PaymentLifecycleError("PAYMENT_REFERENCE_MISMATCH");
  if (event.reference && event.reference !== order.number) throw new PaymentLifecycleError("PAYMENT_REFERENCE_MISMATCH");
  if (event.amountMinor !== order.totalMinor) throw new PaymentLifecycleError("PAYMENT_AMOUNT_MISMATCH");
  if (event.currency ? event.currency.toUpperCase() !== order.currency.toUpperCase() : event.type !== "payment.refund.updated" || !knownPayment) throw new PaymentLifecycleError("PAYMENT_CURRENCY_MISMATCH");
  return { order, attempt, knownPayment };
}

async function processVerifiedEvent(event: PaymentEvent) {
  if (event.livemode !== (process.env.PAYMONGO_LIVEMODE === "true")) throw new PaymentLifecycleError("PAYMENT_MODE_MISMATCH");
  if (event.type === "unknown") {
    await db.webhookEvent.update({ where: { provider_externalEventId: { provider: paymentProvider.name, externalEventId: event.eventId } }, data: { status: "IGNORED", lastErrorCode: "PAYMENT_EVENT_UNSUPPORTED", processedAt: new Date(), resolutionStatus: "ACKNOWLEDGED" } });
    return { ignored: true as const };
  }
  const renewalRequests: RenewalLeaseRequest[] = [];
  await db.$transaction(async (tx) => {
    const { order, attempt, knownPayment } = await resolveOrder(tx, event);
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
    let paymentId = knownPayment?.id;
    const eventLink = { orderId: order.id, paymentAttemptId: attempt?.id, providerCheckoutId: event.externalCheckoutId, providerPaymentId: event.externalPaymentId, providerRefundId: event.externalRefundId };

    if (event.type === "payment.paid") {
      if (!event.externalPaymentId) throw new PaymentLifecycleError("PAYMENT_REFERENCE_MISMATCH");
      if (["PENDING", "CANCELLED"].includes(order.status)) {
        const payment = await tx.payment.upsert({ where: { provider_externalId: { provider: paymentProvider.name, externalId: event.externalPaymentId } }, create: { orderId: order.id, provider: paymentProvider.name, externalId: event.externalPaymentId, status: "PAID", amountMinor: event.amountMinor!, currency: event.currency!, paidAt: event.occurredAt }, update: { status: "PAID", paidAt: event.occurredAt } });
        paymentId = payment.id;
        await tx.order.update({ where: { id: order.id }, data: { status: "PAID", paidAt: event.occurredAt } });
        await issueEntitlements(tx, order.id);
        const subscription = await tx.subscription.findFirst({ where: { orderId: order.id }, include: { purchasePlan: true } });
        if (subscription?.purchasePlan.renewalBehavior === "AUTO_RENEW") {
          const license = await tx.license.findFirst({ where: { orderItem: { orderId: order.id } }, orderBy: { createdAt: "asc" } });
          if (license?.keyCiphertext) {
            const predecessor = await tx.licenseLeaseRecord.findFirst({ where: { licenseId: license.id, status: "ACTIVE" }, orderBy: [{ generation: "desc" }, { serverRevision: "desc" }] });
            if (predecessor) {
              const operationId = `payment-renewal:${order.id}:${subscription.id}`;
              await tx.commercialLeaseOperation.upsert({ where: { operationId }, create: { operationId, licenseId: license.id, action: "RENEWAL", status: "PREPARED", metadata: { subscriptionId: subscription.id, paymentEventId: event.eventId, installationId: predecessor.installationId, deviceId: predecessor.deviceId, predecessorLeaseId: predecessor.leaseId } }, update: {} });
              renewalRequests.push({ licenseKey: decryptLicenseKey(license.keyCiphertext), installationId: predecessor.installationId, deviceId: predecessor.deviceId, operationId, productVersion: predecessor.version, action: "RENEWAL", predecessorLeaseId: predecessor.leaseId });
            }
          }
        }
        await queueCommerceEmail(tx, { type: "PAYMENT_RECEIPT", recipient: order.billingEmail, subject: `Payment received for ${order.number}`, payload: { orderId: order.id, orderNumber: order.number }, deduplicationKey: `payment-receipt:${event.eventId}` });
      }
    } else if (event.type === "payment.failed") {
      await tx.order.update({ where: { id: order.id }, data: { status: "PAYMENT_FAILED" } });
    } else if (event.type === "payment.refund.updated") {
      if (!knownPayment) throw new PaymentLifecycleError("PAYMENT_REFERENCE_MISMATCH");
      await tx.payment.update({ where: { id: knownPayment.id }, data: { status: "REFUNDED", refundedAt: event.occurredAt } });
      await tx.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } });
    }
    await tx.webhookEvent.update({ where: { provider_externalEventId: { provider: paymentProvider.name, externalEventId: event.eventId } }, data: { status: "PROCESSED", processedAt: new Date(), orderId: eventLink.orderId, paymentAttemptId: eventLink.paymentAttemptId, providerCheckoutId: eventLink.providerCheckoutId, providerPaymentId: paymentId ? event.externalPaymentId : undefined, providerRefundId: eventLink.providerRefundId, resolutionStatus: "RESOLVED" } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  for (const renewal of renewalRequests) await issueCommercialLease(renewal);
  await dispatchEmailOutbox(20);
  return { ignored: false as const };
}

export async function ingestPaymentWebhook(request: Request) {
  let event: PaymentEvent;
  try { event = await paymentProvider.verifyWebhook(request); }
  catch (error) { throw new PaymentLifecycleError(safePaymentError(error), { cause: error }); }
  const stored = await db.webhookEvent.upsert({ where: { provider_externalEventId: { provider: paymentProvider.name, externalEventId: event.eventId } }, create: { provider: paymentProvider.name, externalEventId: event.eventId, type: event.type, status: "RECEIVED", rawPayload: normalizedData(event), lastAttemptAt: new Date() }, update: {} });
  if (stored.status === "PROCESSED" || stored.status === "IGNORED") return { duplicate: true, ignored: stored.status === "IGNORED" };
  try { return await processVerifiedEvent(event); }
  catch (error) { const code = safePaymentError(error); await recordFailure(event.eventId, code, error instanceof PaymentLifecycleError ? error.retryable : false); throw error; }
}

export async function retryStoredWebhook(eventId: string) {
  const row = await db.webhookEvent.findUniqueOrThrow({ where: { provider_externalEventId: { provider: paymentProvider.name, externalEventId: eventId } } });
  const event = fromStored(row.rawPayload);
  return processVerifiedEvent(event);
}

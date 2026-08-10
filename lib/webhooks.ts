import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { dispatchEmailOutbox, queueCommerceEmail } from "@/lib/email";
import { issueEntitlements, type RenewalLeaseRequest } from "@/lib/licensing";
import { issueCommercialLease } from "@/lib/licensing/commercial-lease";
import { decryptLicenseKey, sha256 } from "@/lib/security/crypto";
import { paymentProvider } from "@/lib/payments";
import { PaymentLifecycleError, safePaymentError } from "@/lib/payments/errors";
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
        if (attempt) await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "COMPLETED" } });
        const invoice = await tx.invoice.update({ where: { orderId: order.id }, data: { status: "FINAL", issuedAt: event.occurredAt } });
        await issueEntitlements(tx, order.id, { paymentId, paymentEventId: event.eventId }, renewalRequests);
        const redemption = await tx.offerRedemption.findUnique({ where: { orderId: order.id } });
        if (redemption) await tx.offerRedemption.update({ where: { id: redemption.id }, data: { status: "APPLIED", appliedAt: event.occurredAt } });
        const account = await tx.customerAccount.findUniqueOrThrow({ where: { id: order.accountId } });
        await queueCommerceEmail(tx, { type: "PAYMENT_RECEIPT", recipient: account.billingEmail, subject: "BKE Digital Solutions payment receipt", payload: { orderNumber: order.number }, deduplicationKey: `payment-receipt:${order.id}` });
        await queueCommerceEmail(tx, { type: "INVOICE_ISSUED", recipient: account.billingEmail, subject: "Your BKE Digital Solutions invoice", payload: { orderNumber: order.number, invoiceNumber: invoice.number }, deduplicationKey: `invoice-issued:${order.id}` });
        await queueCommerceEmail(tx, { type: "LICENSE_ISSUED", recipient: account.billingEmail, subject: "Your BKE Digital Solutions license is ready", payload: { orderNumber: order.number }, deduplicationKey: `entitlement-issued:${order.id}` });
        await tx.auditLog.create({ data: { accountId: order.accountId, action: order.status === "CANCELLED" ? "PAYMENT_SETTLED_AFTER_LOCAL_CANCELLATION" : "PAYMENT_SETTLED", targetType: "Order", targetId: order.id, metadata: { provider: paymentProvider.name, webhookEventId: event.eventId } } });
      }
    } else if (event.type === "payment.failed") {
      if (["PENDING", "CANCELLED"].includes(order.status)) {
        if (event.externalPaymentId) {
          const payment = await tx.payment.upsert({ where: { provider_externalId: { provider: paymentProvider.name, externalId: event.externalPaymentId } }, create: { orderId: order.id, provider: paymentProvider.name, externalId: event.externalPaymentId, status: "FAILED", amountMinor: event.amountMinor!, currency: event.currency! }, update: { status: "FAILED" } });
          paymentId = payment.id;
        }
        if (attempt) await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED" } });
        const account = await tx.customerAccount.findUniqueOrThrow({ where: { id: order.accountId } });
        await queueCommerceEmail(tx, { type: "PAYMENT_FAILED", recipient: account.billingEmail, subject: "BKE Digital Solutions payment failed", payload: { orderNumber: order.number }, deduplicationKey: `payment-failed:${order.id}` });
        await tx.auditLog.create({ data: { accountId: order.accountId, action: "PAYMENT_FAILED", targetType: "Order", targetId: order.id, metadata: { provider: paymentProvider.name, webhookEventId: event.eventId } } });
      }
    } else if (event.type === "payment.refund.updated" && event.refundStatus !== "succeeded") {
      if (event.externalRefundId) await tx.refundOperation.updateMany({ where: { externalRefundId: event.externalRefundId }, data: { status: event.refundStatus === "failed" ? "FAILED" : "PENDING", lastErrorCode: event.refundStatus === "failed" ? "PAYMENT_REFUND_NOT_ALLOWED" : null } });
    } else {
      if (order.status === "PAID") {
        await tx.payment.updateMany({ where: { orderId: order.id, provider: paymentProvider.name, ...(event.externalPaymentId ? { externalId: event.externalPaymentId } : {}) }, data: { status: "REFUNDED" } });
        await tx.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } });
        await tx.invoice.update({ where: { orderId: order.id }, data: { status: "VOID" } });
        const licenses = await tx.license.findMany({ where: { OR: [{ orderId: order.id }, ...(order.renewalSubscriptionId ? [{ subscriptionId: order.renewalSubscriptionId }] : [])] }, select: { id: true } });
        await tx.license.updateMany({ where: { id: { in: licenses.map((license) => license.id) } }, data: { status: "REVOKED" } });
        await tx.deviceActivation.updateMany({ where: { licenseId: { in: licenses.map((license) => license.id) }, active: true }, data: { active: false, deactivatedAt: new Date() } });
        await tx.subscription.updateMany({ where: { OR: [{ orderId: order.id }, ...(order.renewalSubscriptionId ? [{ id: order.renewalSubscriptionId }] : [])] }, data: { status: "CANCELLED" } });
        await tx.offerRedemption.updateMany({ where: { orderId: order.id }, data: { status: "REFUNDED" } });
        if (event.externalRefundId) await tx.refundOperation.updateMany({ where: { OR: [{ externalRefundId: event.externalRefundId }, { paymentId: paymentId ?? "" }] }, data: { externalRefundId: event.externalRefundId, status: "SUCCEEDED", completedAt: event.occurredAt, lastErrorCode: null } });
        const account = await tx.customerAccount.findUniqueOrThrow({ where: { id: order.accountId } });
        await queueCommerceEmail(tx, { type: "REFUND_CONFIRMED", recipient: account.billingEmail, subject: "BKE Digital Solutions refund confirmed", payload: { orderNumber: order.number }, deduplicationKey: `refund-confirmed:${order.id}` });
        await tx.auditLog.create({ data: { accountId: order.accountId, action: "PAYMENT_REFUND_CONFIRMED", targetType: "Order", targetId: order.id, metadata: { provider: paymentProvider.name, webhookEventId: event.eventId } } });
      } else if (order.status !== "REFUNDED") throw new PaymentLifecycleError("PAYMENT_REFUND_CONFLICT");
    }
    await tx.webhookEvent.update({ where: { provider_externalEventId: { provider: paymentProvider.name, externalEventId: event.eventId } }, data: { ...eventLink, paymentId, status: "PROCESSED", error: null, lastErrorCode: null, mismatchCategory: null, processedAt: new Date(), lastAttemptAt: new Date(), resolutionStatus: "RESOLVED" } });
  }, { isolationLevel: "Serializable" });
  for (const request of renewalRequests) {
    try {
      const license = await db.license.findUniqueOrThrow({
        where: { id: request.licenseId },
        select: {
          keyCiphertext: true,
          activations: { where: { active: true }, select: { deviceHash: true } },
          leaseHistory: { where: { status: "ACTIVE" }, orderBy: { issuedAt: "desc" }, select: { installationId: true, deviceId: true } },
        },
      });
      const activation = license.activations.find((candidate) => candidate.deviceHash === request.deviceHash);
      const binding = license.leaseHistory.find((candidate) => activation && sha256(candidate.deviceId) === activation.deviceHash);
      if (!license.keyCiphertext || !activation || !binding) continue;
      await issueCommercialLease({ licenseKey: decryptLicenseKey(license.keyCiphertext), installationId: binding.installationId, deviceId: binding.deviceId, operationId: request.operationId, action: "RENEWAL" });
    } catch { /* payment remains settled; prepared operation is retryable */ }
  }
  await dispatchEmailOutbox().catch(() => undefined);
  return { processed: true as const };
}

export async function processPaymentWebhook(raw: Buffer, headers: Headers) {
  const event = await paymentProvider.verifyAndParseWebhook(raw, headers);
  const payloadHash = sha256(raw);
  const inserted = await db.webhookEvent.createMany({ data: [{ provider: paymentProvider.name, externalEventId: event.eventId, rawEventType: event.rawType, eventType: event.type, livemode: event.livemode, payloadHash, normalizedData: normalizedData(event) as unknown as Prisma.InputJsonValue, status: "RECEIVED", occurredAt: event.occurredAt, processingAttempts: 1, lastAttemptAt: new Date(), providerCheckoutId: event.externalCheckoutId, providerPaymentId: event.externalPaymentId, providerRefundId: event.externalRefundId }], skipDuplicates: true });
  if (inserted.count === 0) {
    const existing = await db.webhookEvent.findUniqueOrThrow({ where: { provider_externalEventId: { provider: paymentProvider.name, externalEventId: event.eventId } } });
    if (existing.payloadHash !== payloadHash) {
      await db.webhookEvent.update({ where: { id: existing.id }, data: { conflictCount: { increment: 1 }, lastErrorCode: "PAYMENT_EVENT_REPLAY_CONFLICT", resolutionStatus: "OPEN" } });
      throw new PaymentLifecycleError("PAYMENT_EVENT_REPLAY_CONFLICT");
    }
    if (existing.status !== "FAILED") return { duplicate: true as const };
    await db.webhookEvent.update({ where: { id: existing.id }, data: { status: "RECEIVED", error: null, lastErrorCode: null, processedAt: null, processingAttempts: { increment: 1 }, lastAttemptAt: new Date() } });
  }
  try { return await processVerifiedEvent(event); }
  catch (error) {
    const prismaRetry = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
    const code = prismaRetry ? "PAYMENT_PROCESSING_RETRYABLE" : safePaymentError(error);
    await recordFailure(event.eventId, code, prismaRetry || (error instanceof PaymentLifecycleError && error.retryable));
    throw new PaymentLifecycleError(code, prismaRetry || (error instanceof PaymentLifecycleError && error.retryable));
  }
}

export async function retryStoredWebhook(webhookId: string) {
  const row = await db.webhookEvent.findUnique({ where: { id: webhookId } });
  if (!row) throw new Error("NOT_FOUND");
  if (row.status !== "FAILED" || !row.normalizedData) throw new PaymentLifecycleError("PAYMENT_RECONCILIATION_REQUIRED");
  const event = fromStored(row.normalizedData);
  await db.webhookEvent.update({ where: { id: row.id }, data: { status: "RECEIVED", processingAttempts: { increment: 1 }, lastAttemptAt: new Date(), error: null, lastErrorCode: null } });
  try { return await processVerifiedEvent(event); }
  catch (error) { const code = safePaymentError(error); await recordFailure(event.eventId, code, error instanceof PaymentLifecycleError && error.retryable); throw error; }
}

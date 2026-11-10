import "server-only";

import type { PaymentsVerifiedProviderEventSnapshot } from "@bke/payments/contracts/provider-event-ingestion.contract";
import { PaymentLifecycleError, safePaymentError } from "@bke/payments/logic/payment-errors";
import { Prisma } from "@/platform/persistence/generated/prisma/client";
import { db } from "@/platform/host/db";
import { issueCommercialLease } from "@/apps/web/licensing/commercial-lease";
import {
  fulfillOrderLicensing,
  type RenewalLeaseRequest,
} from "@/apps/web/licensing/entitlement-management";
import { decryptLicenseKey, sha256 } from "@/platform/host/security/crypto";
import { paymentProvider } from "@/apps/web/payments/compatibility-provider";
import { ingestPaymentWebhook } from "@/apps/web/payments/webhook-ingestion";
import { matchesProvenSettledCompanion, type ProvenSettledPayment } from "@/apps/web/payments/companion-paid-event";
import { reactToPaidSettlement } from "@/apps/web/payments/settlement-transaction";
import { queueVerifiedPurchaseConfirmation } from "@/apps/web/email/purchase-confirmation";
import { persistNotification } from "@/apps/web/notifications/center";
import { revokeOrderEntitlements } from "@/apps/web/entitlements/refund-revocation";

type StoredEvent = Readonly<{
  eventId: string;
  rawType?: string;
  type: PaymentsVerifiedProviderEventSnapshot["type"];
  externalPaymentId?: string;
  externalCheckoutId?: string;
  reference?: string;
  externalRefundId?: string;
  refundStatus?: PaymentsVerifiedProviderEventSnapshot["refundStatus"];
  amountMinor?: number;
  currency?: string;
  livemode: boolean;
  occurredAt: string;
  eventFingerprint?: string;
}>;

type OwnerEventRow = Readonly<{
  id: string;
  provider: string;
  eventId: string;
  rawType: string | null;
  type: PaymentsVerifiedProviderEventSnapshot["type"];
  externalPaymentId: string | null;
  externalCheckoutId: string | null;
  reference: string | null;
  externalRefundId: string | null;
  refundStatus: PaymentsVerifiedProviderEventSnapshot["refundStatus"] | null;
  amountMinor: number | null;
  currency: string | null;
  livemode: boolean;
  occurredAt: Date;
  receivedAt: Date;
}>;

type PackageAttemptRow = Readonly<{
  id: string;
  commercialReference: string;
  status: string;
}>;

function storedEvent(value: unknown): StoredEvent {
  const event = value as StoredEvent | null;
  if (!event?.eventId || !event.type || !event.occurredAt) {
    throw new PaymentLifecycleError("PAYMENT_RECONCILIATION_REQUIRED");
  }
  return event;
}

function snapshot(row: OwnerEventRow): PaymentsVerifiedProviderEventSnapshot {
  return Object.freeze({
    providerEventRecordId: row.id,
    provider: row.provider,
    eventId: row.eventId,
    ...(row.rawType ? { rawType: row.rawType } : {}),
    type: row.type,
    ...(row.externalPaymentId ? { externalPaymentId: row.externalPaymentId } : {}),
    ...(row.externalCheckoutId ? { externalCheckoutId: row.externalCheckoutId } : {}),
    ...(row.reference ? { reference: row.reference } : {}),
    ...(row.externalRefundId ? { externalRefundId: row.externalRefundId } : {}),
    ...(row.refundStatus ? { refundStatus: row.refundStatus } : {}),
    ...(row.amountMinor !== null ? { amountMinor: Number(row.amountMinor) } : {}),
    ...(row.currency ? { currency: row.currency } : {}),
    livemode: row.livemode,
    occurredAt: new Date(row.occurredAt),
    receivedAt: new Date(row.receivedAt),
  });
}

async function ownerEventForStoredWebhook(row: {
  id: string;
  provider: string;
  externalEventId: string;
  rawEventType: string | null;
  payloadHash: string;
  normalizedData: unknown;
  livemode: boolean;
  occurredAt: Date | null;
  receivedAt: Date;
}) {
  const existing = await db.$queryRaw<OwnerEventRow[]>`
    SELECT "id", "provider", "eventId", "rawType", "type", "externalPaymentId", "externalCheckoutId",
           "reference", "externalRefundId", "refundStatus", "amountMinor", "currency", "livemode",
           "occurredAt", "receivedAt"
      FROM "PaymentProviderEvent"
     WHERE "provider" = ${row.provider} AND "eventId" = ${row.externalEventId}
     LIMIT 1
  `;
  if (existing[0]) return snapshot(existing[0]);

  const event = storedEvent(row.normalizedData);
  const eventFingerprint = event.eventFingerprint ?? row.payloadHash;
  await db.$executeRaw`
    INSERT INTO "PaymentProviderEvent" (
      "id", "provider", "eventId", "payloadHash", "eventFingerprint", "rawType", "type",
      "externalPaymentId", "externalCheckoutId", "reference", "externalRefundId", "refundStatus",
      "amountMinor", "currency", "livemode", "occurredAt", "receivedAt"
    ) VALUES (
      ${row.id}, ${row.provider}, ${row.externalEventId}, ${row.payloadHash}, ${eventFingerprint},
      ${row.rawEventType ?? event.rawType ?? null}, ${event.type}, ${event.externalPaymentId ?? null},
      ${event.externalCheckoutId ?? null}, ${event.reference ?? null}, ${event.externalRefundId ?? null},
      ${event.refundStatus ?? null}, ${event.amountMinor ?? null}, ${event.currency ?? null}, ${row.livemode},
      ${row.occurredAt ?? new Date(event.occurredAt)}, ${row.receivedAt}
    )
    ON CONFLICT ("provider", "eventId") DO NOTHING
  `;
  const created = await db.$queryRaw<OwnerEventRow[]>`
    SELECT "id", "provider", "eventId", "rawType", "type", "externalPaymentId", "externalCheckoutId",
           "reference", "externalRefundId", "refundStatus", "amountMinor", "currency", "livemode",
           "occurredAt", "receivedAt"
      FROM "PaymentProviderEvent"
     WHERE "provider" = ${row.provider} AND "eventId" = ${row.externalEventId}
     LIMIT 1
  `;
  if (!created[0]) throw new PaymentLifecycleError("PAYMENT_PROCESSING_RETRYABLE", true);
  return snapshot(created[0]);
}

async function recordFailure(eventId: string, code: string, retryable: boolean) {
  await db.webhookEvent.update({
    where: {
      provider_externalEventId: {
        provider: paymentProvider.name,
        externalEventId: eventId,
      },
    },
    data: {
      status: "FAILED",
      error: code,
      lastErrorCode: code,
      mismatchCategory: code.includes("MISMATCH") ? code : undefined,
      resolutionStatus: "OPEN",
      lastAttemptAt: new Date(),
      ...(retryable ? {} : { processedAt: null }),
    },
  });
}

async function resolveOperationalOrder(
  tx: Prisma.TransactionClient,
  event: PaymentsVerifiedProviderEventSnapshot,
) {
  const hostAttempt = event.externalCheckoutId
    ? await tx.paymentAttempt.findUnique({
        where: { externalCheckoutId: event.externalCheckoutId },
        include: { order: true },
      })
    : null;
  const packageAttemptRows = event.externalCheckoutId
    ? await tx.$queryRaw<PackageAttemptRow[]>`
        SELECT "id", "commercialReference", "status"
          FROM "PaymentCheckoutAttempt"
         WHERE "provider" = ${event.provider} AND "externalCheckoutId" = ${event.externalCheckoutId}
         LIMIT 1
      `
    : [];
  const packageAttempt = packageAttemptRows[0];
  const packageOrder = packageAttempt
    ? await tx.order.findUnique({ where: { id: packageAttempt.commercialReference } })
    : null;
  const byReference = event.reference
    ? await tx.order.findFirst({
        where: { OR: [{ id: event.reference }, { number: event.reference }] },
      })
    : null;
  const knownPayment = event.externalPaymentId
    ? await tx.payment.findUnique({
        where: {
          provider_externalId: {
            provider: event.provider,
            externalId: event.externalPaymentId,
          },
        },
        include: { order: true },
      })
    : null;

  if (event.externalCheckoutId && !hostAttempt && !packageAttempt && !knownPayment) {
    throw new PaymentLifecycleError("PAYMENT_CHECKOUT_MISMATCH");
  }
  const order = hostAttempt?.order ?? packageOrder ?? byReference ?? knownPayment?.order;
  if (!order) throw new PaymentLifecycleError("PAYMENT_REFERENCE_MISMATCH");
  if (hostAttempt && packageOrder && hostAttempt.orderId !== packageOrder.id) {
    throw new PaymentLifecycleError("PAYMENT_CHECKOUT_MISMATCH");
  }
  if (byReference && byReference.id !== order.id) {
    throw new PaymentLifecycleError("PAYMENT_REFERENCE_MISMATCH");
  }
  if (knownPayment && knownPayment.orderId !== order.id) {
    throw new PaymentLifecycleError("PAYMENT_REFERENCE_MISMATCH");
  }
  if (event.reference && event.reference !== order.id && event.reference !== order.number) {
    throw new PaymentLifecycleError("PAYMENT_REFERENCE_MISMATCH");
  }
  if (event.amountMinor !== order.totalMinor) {
    throw new PaymentLifecycleError("PAYMENT_AMOUNT_MISMATCH");
  }
  if (
    event.currency
      ? event.currency.toUpperCase() !== order.currency.toUpperCase()
      : event.type !== "payment.refund.updated" || !knownPayment
  ) {
    throw new PaymentLifecycleError("PAYMENT_CURRENCY_MISMATCH");
  }
  return { order, hostAttempt, packageAttempt, knownPayment };
}

async function processPaidEvent(
  tx: Prisma.TransactionClient,
  event: PaymentsVerifiedProviderEventSnapshot,
  renewalRequests: RenewalLeaseRequest[],
) {
  if (!event.externalPaymentId || event.amountMinor === undefined || !event.currency) {
    throw new PaymentLifecycleError("PAYMENT_REFERENCE_MISMATCH");
  }
  const settlement = await reactToPaidSettlement(
    tx,
    event.providerEventRecordId,
    process.env.PAYMONGO_LIVEMODE === "true",
  );
  const order = await tx.order.findUniqueOrThrow({ where: { id: settlement.orderId } });
  const payment = await tx.payment.upsert({
    where: {
      provider_externalId: {
        provider: event.provider,
        externalId: event.externalPaymentId,
      },
    },
    create: {
      orderId: order.id,
      provider: event.provider,
      externalId: event.externalPaymentId,
      status: "PAID",
      amountMinor: event.amountMinor,
      currency: event.currency,
      paidAt: event.occurredAt,
    },
    update: { status: "PAID", paidAt: event.occurredAt },
  });
  const hostAttempt = event.externalCheckoutId
    ? await tx.paymentAttempt.findUnique({ where: { externalCheckoutId: event.externalCheckoutId } })
    : null;
  if (hostAttempt) {
    await tx.paymentAttempt.update({ where: { id: hostAttempt.id }, data: { status: "COMPLETED" } });
  }

  if (settlement.paymentSettlementDisposition === "CREATED") {
    if (settlement.fulfillmentMode === "ACCOUNT_ENTITLEMENT") {
      await fulfillOrderLicensing(
        tx,
        order.id,
        { paymentId: payment.id, paymentEventId: event.eventId },
        renewalRequests,
      );
    }
    await tx.auditLog.create({
      data: {
        accountId: order.accountId,
        action: settlement.settlementDisposition === "AFTER_LOCAL_CANCELLATION"
          ? "PAYMENT_SETTLED_AFTER_LOCAL_CANCELLATION"
          : "PAYMENT_SETTLED",
        targetType: "Order",
        targetId: order.id,
        metadata: {
          provider: event.provider,
          webhookEventId: event.eventId,
          fulfillmentMode: settlement.fulfillmentMode,
        },
      },
    });
  }

  // Only the new settled order may queue once, after verified fulfillment.
  // This transaction never sends to an external email provider.
  if (settlement.paymentSettlementDisposition === "CREATED") {
    await queueVerifiedPurchaseConfirmation(tx, {
      orderId: order.id,
      fulfillmentMode: settlement.fulfillmentMode,
    });
  }

  await persistNotification(tx, {
    source: {
      moduleId: "payments",
      event: "PAYMENT_RECEIVED",
      sourceReference: payment.id,
    },
    audience: { kind: "ACCOUNT", accountId: order.accountId },
    content: {
      title: "Payment received",
      body: `Payment for order ${order.number} was confirmed.`,
      category: "TRANSACTIONAL",
      data: {
        orderId: order.id,
        orderNumber: order.number,
        paymentId: payment.id,
      },
    },
    context: {
      trigger: "PAYMENT_SETTLED",
      placementHint: "digital-solutions-inbox",
    },
    priority: "NORMAL",
    idempotencyKey: `payment-received:${payment.id}`,
    createdAt: event.occurredAt,
  });

  const invoice = await tx.invoice.findUnique({
    where: { orderId: order.id },
    select: { id: true, number: true, status: true, issuedAt: true },
  });
  if (invoice?.status === "FINAL") {
    await persistNotification(tx, {
      source: {
        moduleId: "commerce",
        event: "INVOICE_READY",
        sourceReference: invoice.id,
      },
      audience: { kind: "ACCOUNT", accountId: order.accountId },
      content: {
        title: "Invoice ready",
        body: `Invoice ${invoice.number} is available in your customer portal.`,
        category: "TRANSACTIONAL",
        data: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          orderId: order.id,
          orderNumber: order.number,
        },
      },
      context: {
        trigger: "PAYMENT_SETTLED",
        placementHint: "digital-solutions-inbox",
      },
      priority: "NORMAL",
      idempotencyKey: `invoice-ready:${invoice.id}`,
      createdAt: invoice.issuedAt ?? event.occurredAt,
    });
  }

  const activeLicenses = await tx.license.findMany({
    where: { orderId: order.id, status: "ACTIVE" },
    select: { id: true, productId: true },
  });
  for (const license of activeLicenses) {
    await persistNotification(tx, {
      source: {
        moduleId: "licensing",
        event: "LICENSE_READY",
        sourceReference: license.id,
      },
      audience: { kind: "ACCOUNT", accountId: order.accountId },
      content: {
        title: "License ready",
        body: `Licensed access for order ${order.number} is ready.`,
        category: "LICENSE",
        data: {
          licenseId: license.id,
          orderId: order.id,
          orderNumber: order.number,
        },
      },
      context: {
        trigger: "LICENSE_EVENT",
        placementHint: "product-inbox",
      },
      priority: "NORMAL",
      idempotencyKey: `license-ready:${license.id}`,
      productId: license.productId,
      createdAt: event.occurredAt,
    });
  }

  return { order, paymentId: payment.id, hostAttemptId: hostAttempt?.id };
}

type ExistingCompanionSettlement = ProvenSettledPayment & Readonly<{ checkoutId: string }>;

/**
 * PayMongo may emit a second signed raw payment.paid notification without the
 * checkout session or order reference included in checkout_session.payment.paid.
 * A raw payment notification is NEVER independent settlement authority.
 *
 * Acknowledge it only if the same provider payment has already been settled by
 * the canonical checkout event, with identical financial terms and environment.
 * Before canonical settlement (or on mismatch), preserve the existing
 * fail-closed reconciliation behavior.
 */
async function acknowledgeSettledCompanionPayment(
  event: PaymentsVerifiedProviderEventSnapshot,
): Promise<boolean> {
  if (
    event.type !== "payment.paid" ||
    event.rawType !== "payment.paid" ||
    event.externalCheckoutId ||
    event.reference ||
    !event.externalPaymentId
  ) return false;

  return db.$transaction(async (tx) => {
    const settlements = await tx.$queryRaw<ExistingCompanionSettlement[]>`
      SELECT p."id" AS "paymentId", o."id" AS "orderId",
             p."externalId" AS "externalPaymentId",
             p."amountMinor" AS "amountMinor", p."currency" AS "currency",
             sf."livemode" AS "livemode", sf."externalCheckoutId" AS "checkoutId"
        FROM "Payment" p
        JOIN "Order" o ON o."id" = p."orderId"
        JOIN "PaymentSettlementFact" sf
          ON sf."provider" = p."provider"
         AND sf."externalPaymentId" = p."externalId"
         AND sf."commercialReference" IN (o."id", o."number")
        JOIN "WebhookEvent" checkout
          ON checkout."provider" = sf."provider"
         AND checkout."externalEventId" = sf."eventId"
         AND checkout."rawEventType" = 'checkout_session.payment.paid'
         AND checkout."status" = 'PROCESSED'
         AND checkout."providerPaymentId" = p."externalId"
         AND checkout."orderId" = o."id"
       WHERE p."provider" = ${event.provider}
         AND p."externalId" = ${event.externalPaymentId}
         AND p."status" = 'PAID'
         AND o."status" = 'PAID'
         AND sf."amountMinor" = p."amountMinor"
         AND sf."amountMinor" = o."totalMinor"
         AND UPPER(sf."currency") = UPPER(p."currency")
         AND UPPER(sf."currency") = UPPER(o."currency")
         AND sf."livemode" = ${event.livemode}
       LIMIT 1
    `;
    const settlement = settlements[0] ?? null;
    if (!matchesProvenSettledCompanion(event, settlement)) return false;

    await tx.webhookEvent.update({
      where: {
        provider_externalEventId: {
          provider: event.provider,
          externalEventId: event.eventId,
        },
      },
      data: {
        orderId: settlement.orderId,
        paymentId: settlement.paymentId,
        providerPaymentId: settlement.externalPaymentId,
        providerCheckoutId: settlement.checkoutId,
        status: "IGNORED",
        error: null,
        lastErrorCode: null,
        mismatchCategory: null,
        processedAt: new Date(),
        lastAttemptAt: new Date(),
        resolutionStatus: "ACKNOWLEDGED",
        resolutionCode: "SETTLED_COMPANION_NOTIFICATION",
      },
    });
    return true;
  }, { isolationLevel: "Serializable" });
}

async function processVerifiedEvent(event: PaymentsVerifiedProviderEventSnapshot) {
  if (event.livemode !== (process.env.PAYMONGO_LIVEMODE === "true")) {
    throw new PaymentLifecycleError("PAYMENT_MODE_MISMATCH");
  }
  if (event.type === "unknown") {
    await db.webhookEvent.update({
      where: {
        provider_externalEventId: {
          provider: event.provider,
          externalEventId: event.eventId,
        },
      },
      data: {
        status: "IGNORED",
        lastErrorCode: "PAYMENT_EVENT_UNSUPPORTED",
        processedAt: new Date(),
        resolutionStatus: "ACKNOWLEDGED",
      },
    });
    return { ignored: true as const };
  }

  if (await acknowledgeSettledCompanionPayment(event)) {
    return { ignored: true as const };
  }

  const renewalRequests: RenewalLeaseRequest[] = [];
  let paidOrderId: string | undefined;
  await db.$transaction(async (tx) => {
    let orderId: string;
    let hostAttemptId: string | undefined;
    let paymentId: string | undefined;

    if (event.type === "payment.paid") {
      const paid = await processPaidEvent(tx, event, renewalRequests);
      orderId = paid.order.id;
      paidOrderId = orderId;
      hostAttemptId = paid.hostAttemptId;
      paymentId = paid.paymentId;
    } else {
      const { order, hostAttempt, packageAttempt, knownPayment } = await resolveOperationalOrder(tx, event);
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
      orderId = order.id;
      hostAttemptId = hostAttempt?.id;
      paymentId = knownPayment?.id;

      if (event.type === "payment.failed") {
        if (order.status === "PENDING" || order.status === "CANCELLED") {
          if (event.externalPaymentId && event.amountMinor !== undefined && event.currency) {
            const payment = await tx.payment.upsert({
              where: {
                provider_externalId: {
                  provider: event.provider,
                  externalId: event.externalPaymentId,
                },
              },
              create: {
                orderId: order.id,
                provider: event.provider,
                externalId: event.externalPaymentId,
                status: "FAILED",
                amountMinor: event.amountMinor,
                currency: event.currency,
              },
              update: { status: "FAILED" },
            });
            paymentId = payment.id;
          }
          if (hostAttempt) {
            await tx.paymentAttempt.update({ where: { id: hostAttempt.id }, data: { status: "FAILED" } });
          }
          if (packageAttempt) {
            await tx.$executeRaw`
              UPDATE "PaymentCheckoutAttempt"
                 SET "status" = 'FAILED', "failureCode" = 'PAYMENT_FAILED', "updatedAt" = NOW()
               WHERE "id" = ${packageAttempt.id}
            `;
          }
          await tx.auditLog.create({
            data: {
              accountId: order.accountId,
              action: "PAYMENT_FAILED",
              targetType: "Order",
              targetId: order.id,
              metadata: { provider: event.provider, webhookEventId: event.eventId },
            },
          });
          await persistNotification(tx, {
            source: {
              moduleId: "payments",
              event: "PAYMENT_FAILED",
              sourceReference: paymentId ?? event.eventId,
            },
            audience: { kind: "ACCOUNT", accountId: order.accountId },
            content: {
              title: "Payment failed",
              body: `Payment for order ${order.number} was not completed.`,
              category: "TRANSACTIONAL",
              data: {
                orderId: order.id,
                orderNumber: order.number,
                paymentId: paymentId ?? null,
              },
            },
            context: {
              trigger: "CUSTOM",
              placementHint: "digital-solutions-inbox",
            },
            priority: "HIGH",
            idempotencyKey: `payment-failed:${paymentId ?? event.eventId}`,
            createdAt: event.occurredAt,
          });
        }
      } else if (event.type === "payment.refund.updated" && event.refundStatus !== "succeeded") {
        if (event.externalRefundId) {
          await tx.refundOperation.updateMany({
            where: { externalRefundId: event.externalRefundId },
            data: {
              status: event.refundStatus === "failed" ? "FAILED" : "PENDING",
              lastErrorCode: event.refundStatus === "failed" ? "PAYMENT_REFUND_NOT_ALLOWED" : null,
            },
          });
        }
      } else if (order.status === "PAID") {
        await tx.payment.updateMany({
          where: {
            orderId: order.id,
            provider: event.provider,
            ...(event.externalPaymentId ? { externalId: event.externalPaymentId } : {}),
          },
          data: { status: "REFUNDED" },
        });
        await tx.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } });
        await tx.invoice.update({ where: { orderId: order.id }, data: { status: "VOID" } });
        await tx.$executeRaw`
          UPDATE "ClaimCode"
             SET "status" = 'REVOKED',
                 "revokedAt" = ${event.occurredAt},
                 "codeCiphertext" = NULL,
                 "updatedAt" = NOW()
           WHERE "orderId" = ${order.id}
             AND "status" = 'AVAILABLE'
        `;
        const refundFulfillmentRows = await tx.$queryRaw<Array<{
          fulfillmentMode: "ACCOUNT_ENTITLEMENT" | "CLAIM_CODE";
        }>>`
          SELECT "fulfillmentMode"::text AS "fulfillmentMode"
            FROM "Order"
           WHERE "id" = ${order.id}
           LIMIT 1
        `;
        const refundFulfillmentMode = refundFulfillmentRows[0]?.fulfillmentMode;
        if (!refundFulfillmentMode) {
          throw new PaymentLifecycleError("PAYMENT_RECONCILIATION_REQUIRED");
        }
        if (refundFulfillmentMode === "ACCOUNT_ENTITLEMENT") {
          await revokeOrderEntitlements(tx, order.id, {
            revocationReference: `refund:${event.provider}:${event.externalRefundId ?? event.eventId}`,
            revocationSnapshot: {
              reason: "REFUND_CONFIRMED",
              orderId: order.id,
              provider: event.provider,
              eventId: event.eventId,
              externalRefundId: event.externalRefundId ?? null,
            },
            revokedAt: event.occurredAt,
          });
        }
        const licenses = await tx.license.findMany({
          where: {
            OR: [
              { orderId: order.id },
              ...(order.renewalSubscriptionId
                ? [{ subscriptionId: order.renewalSubscriptionId }]
                : []),
            ],
          },
          select: { id: true },
        });
        const licenseIds = licenses.map((license) => license.id);
        await tx.license.updateMany({ where: { id: { in: licenseIds } }, data: { status: "REVOKED" } });
        await tx.deviceActivation.updateMany({
          where: { licenseId: { in: licenseIds }, active: true },
          data: { active: false, deactivatedAt: new Date() },
        });
        await tx.subscription.updateMany({
          where: {
            OR: [
              { orderId: order.id },
              ...(order.renewalSubscriptionId ? [{ id: order.renewalSubscriptionId }] : []),
            ],
          },
          data: { status: "CANCELLED" },
        });
        await tx.offerRedemption.updateMany({
          where: { orderId: order.id },
          data: { status: "REFUNDED" },
        });
        if (event.externalRefundId) {
          await tx.refundOperation.updateMany({
            where: {
              OR: [
                { externalRefundId: event.externalRefundId },
                { paymentId: paymentId ?? "" },
              ],
            },
            data: {
              externalRefundId: event.externalRefundId,
              status: "SUCCEEDED",
              completedAt: event.occurredAt,
              lastErrorCode: null,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            accountId: order.accountId,
            action: "PAYMENT_REFUND_CONFIRMED",
            targetType: "Order",
            targetId: order.id,
            metadata: { provider: event.provider, webhookEventId: event.eventId },
          },
        });
        await persistNotification(tx, {
          source: {
            moduleId: "payments",
            event: "REFUND_CONFIRMED",
            sourceReference: event.externalRefundId ?? event.eventId,
          },
          audience: { kind: "ACCOUNT", accountId: order.accountId },
          content: {
            title: "Refund confirmed",
            body: `The refund for order ${order.number} was confirmed.`,
            category: "TRANSACTIONAL",
            data: {
              orderId: order.id,
              orderNumber: order.number,
              paymentId: paymentId ?? null,
              refundId: event.externalRefundId ?? null,
            },
          },
          context: {
            trigger: "CUSTOM",
            placementHint: "digital-solutions-inbox",
          },
          priority: "NORMAL",
          idempotencyKey: `refund-confirmed:${event.externalRefundId ?? event.eventId}`,
          createdAt: event.occurredAt,
        });
      } else if (order.status !== "REFUNDED") {
        throw new PaymentLifecycleError("PAYMENT_REFUND_CONFLICT");
      }
    }

    await tx.webhookEvent.update({
      where: {
        provider_externalEventId: {
          provider: event.provider,
          externalEventId: event.eventId,
        },
      },
      data: {
        orderId,
        paymentAttemptId: hostAttemptId,
        paymentId,
        providerCheckoutId: event.externalCheckoutId,
        providerPaymentId: event.externalPaymentId,
        providerRefundId: event.externalRefundId,
        status: "PROCESSED",
        error: null,
        lastErrorCode: null,
        mismatchCategory: null,
        processedAt: new Date(),
        lastAttemptAt: new Date(),
        resolutionStatus: "RESOLVED",
      },
    });
  }, { isolationLevel: "Serializable" });

  for (const request of renewalRequests) {
    try {
      const license = await db.license.findUniqueOrThrow({
        where: { id: request.licenseId },
        select: {
          keyCiphertext: true,
          activations: {
            where: { active: true },
            select: { deviceHash: true },
          },
          leaseHistory: {
            where: { status: "ACTIVE" },
            orderBy: { issuedAt: "desc" },
            select: { installationId: true, deviceId: true, version: true },
          },
        },
      });
      const activation = license.activations.find(
        (candidate) => candidate.deviceHash === request.deviceHash,
      );
      const binding = license.leaseHistory.find(
        (candidate) => activation && sha256(candidate.deviceId) === activation.deviceHash,
      );
      if (!license.keyCiphertext || !activation || !binding) continue;
      await issueCommercialLease({
        licenseKey: decryptLicenseKey(license.keyCiphertext),
        installationId: binding.installationId,
        deviceId: binding.deviceId,
        operationId: request.operationId,
        productVersion: binding.version,
        action: "RENEWAL",
      });
    } catch {
      // Payment remains settled; the PREPARED lease operation stays retryable.
    }
  }
  return { processed: true as const, paidOrderId };
}

/** Route-only postcommit signal; the public webhook response remains unchanged. */
export async function processPaymentWebhookWithOutcome(raw: Buffer, headers: Headers) {
  const ingestion = await ingestPaymentWebhook(raw, headers);
  const event = ingestion.event;
  if (ingestion.duplicate) {
    return { result: { duplicate: true as const }, verifiedPaid: false, paidOrderId: undefined };
  }
  try {
    const outcome = await processVerifiedEvent(event);
    const verifiedPaid = event.type === "payment.paid" &&
      "processed" in outcome && outcome.processed === true;
    // Keep the public webhook response unchanged. The order reference is
    // server-only post-commit metadata for that exact invoice's outbox row.
    const result = "processed" in outcome ? { processed: true as const } : outcome;
    return {
      result, verifiedPaid,
      paidOrderId: verifiedPaid && "paidOrderId" in outcome ? outcome.paidOrderId : undefined,
    };
  } catch (error) {
    const prismaRetry = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
    const code = prismaRetry ? "PAYMENT_PROCESSING_RETRYABLE" : safePaymentError(error);
    const retryable = prismaRetry || (error instanceof PaymentLifecycleError && error.retryable);
    await recordFailure(event.eventId, code, retryable);
    throw new PaymentLifecycleError(code, retryable);
  }
}

export async function processPaymentWebhook(raw: Buffer, headers: Headers) {
  const { result } = await processPaymentWebhookWithOutcome(raw, headers);
  return result;
}

export async function retryStoredWebhook(webhookId: string) {
  const row = await db.webhookEvent.findUnique({ where: { id: webhookId } });
  if (!row) throw new Error("NOT_FOUND");
  if (row.status !== "FAILED" || !row.normalizedData) {
    throw new PaymentLifecycleError("PAYMENT_RECONCILIATION_REQUIRED");
  }
  const event = await ownerEventForStoredWebhook(row);
  await db.webhookEvent.update({
    where: { id: row.id },
    data: {
      status: "RECEIVED",
      processingAttempts: { increment: 1 },
      lastAttemptAt: new Date(),
      error: null,
      lastErrorCode: null,
    },
  });
  try {
    return await processVerifiedEvent(event);
  } catch (error) {
    const code = safePaymentError(error);
    const retryable = error instanceof PaymentLifecycleError && error.retryable;
    await recordFailure(event.eventId, code, retryable);
    throw error;
  }
}

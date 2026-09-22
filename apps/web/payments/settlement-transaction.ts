import "server-only";

import { randomUUID } from "node:crypto";
import { createCommerceSettlementFulfillmentCapability } from "@bke/commerce/logic/settlement-fulfillment";
import type { CommerceSettlementFulfillmentRepository } from "@bke/commerce/logic/settlement-fulfillment-repository";
import type { CommerceSettlementEntitlementInput } from "@bke/commerce/logic/settlement-reaction-ports";
import { createEntitlementsDurableRightGrantCapability } from "@bke/entitlements/logic/durable-right-grant";
import type {
  EntitlementsDurableRightGrantRepository,
  EntitlementsDurableRightGrantRepositoryResult,
} from "@bke/entitlements/logic/durable-right-grant-repository";
import { createPaymentsSettlementFactCapability } from "@bke/payments/logic/settlement-fact";
import type {
  PaymentsSettlementFactClaim,
  PaymentsSettlementFactRepository,
} from "@bke/payments/logic/settlement-fact-repository";
import type { PaymentsCheckoutAttemptRecord } from "@bke/payments/logic/checkout-attempt-repository";
import type { PaymentsProviderEventRecord } from "@bke/payments/logic/provider-event-repository";
import type { PaymentsSettlementFactSnapshot } from "@bke/payments/contracts/settlement-fact.contract";
import { PaymentLifecycleError, type PaymentErrorCode } from "@bke/payments/logic/payment-errors";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { createTransactionalClaimUnitIssuer } from "@/apps/web/entitlements/claim-unit-issuer";

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

type CheckoutAttemptRow = Readonly<{
  id: string;
  sourceReference: string;
  commercialReference: string;
  provider: string;
  requestFingerprint: string;
  amountMinor: number;
  currency: string;
  payerSnapshot: unknown;
  itemsSnapshot: unknown;
  status: PaymentsCheckoutAttemptRecord["status"];
  externalCheckoutId: string | null;
  checkoutUrl: string | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

type SettlementFactRow = Readonly<{
  id: string;
  providerEventRecordId: string;
  checkoutAttemptId: string;
  provider: string;
  eventId: string;
  externalPaymentId: string;
  externalCheckoutId: string;
  commercialReference: string;
  amountMinor: number;
  currency: string;
  livemode: boolean;
  settledAt: Date;
  createdAt: Date;
}>;

type EntitlementsGrantRepositoryInput = Parameters<EntitlementsDurableRightGrantRepository["grant"]>[0];
type CommerceSettlementRepositoryInput = Parameters<CommerceSettlementFulfillmentRepository["settle"]>[0];

type OrderFulfillmentRow = Readonly<{
  fulfillmentMode: "ACCOUNT_ENTITLEMENT" | "CLAIM_CODE";
  fulfillmentSnapshot: unknown;
}>;

type EntitlementRow = Readonly<{
  id: string;
  subjectId: string;
  resourceId: string;
  sourceReference: string;
  status: "ACTIVE";
  quantity: number;
  scopeSnapshot: unknown;
  grantSnapshot: unknown;
  validFrom: Date;
  validUntil: Date | null;
  createdAt: Date;
}>;

function paymentRecord(row: ProviderEventRow): PaymentsProviderEventRecord {
  return Object.freeze({ ...row });
}

function checkoutRecord(row: CheckoutAttemptRow): PaymentsCheckoutAttemptRecord {
  return Object.freeze({ ...row });
}

function settlementRecord(row: SettlementFactRow): PaymentsSettlementFactSnapshot {
  return Object.freeze({
    settlementFactId: row.id,
    providerEventRecordId: row.providerEventRecordId,
    checkoutAttemptId: row.checkoutAttemptId,
    provider: row.provider,
    eventId: row.eventId,
    externalPaymentId: row.externalPaymentId,
    externalCheckoutId: row.externalCheckoutId,
    commercialReference: row.commercialReference,
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
    livemode: row.livemode,
    settledAt: new Date(row.settledAt),
    createdAt: new Date(row.createdAt),
  });
}

function createPaymentsRepository(tx: Prisma.TransactionClient): PaymentsSettlementFactRepository {
  return Object.freeze({
    async findProviderEventById(id: string) {
      const rows = await tx.$queryRaw<ProviderEventRow[]>`
        SELECT "id", "provider", "eventId", "payloadHash", "eventFingerprint", "rawType", "type",
               "externalPaymentId", "externalCheckoutId", "reference", "externalRefundId", "refundStatus",
               "amountMinor", "currency", "livemode", "occurredAt", "receivedAt"
          FROM "PaymentProviderEvent"
         WHERE "id" = ${id}
         LIMIT 1
      `;
      return rows[0] ? paymentRecord(rows[0]) : null;
    },

    async findCheckoutAttempt(provider: string, externalCheckoutId: string) {
      const rows = await tx.$queryRaw<CheckoutAttemptRow[]>`
        SELECT "id", "sourceReference", "commercialReference", "provider", "requestFingerprint",
               "amountMinor", "currency", "payerSnapshot", "itemsSnapshot", "status", "externalCheckoutId",
               "checkoutUrl", "failureCode", "createdAt", "updatedAt"
          FROM "PaymentCheckoutAttempt"
         WHERE "provider" = ${provider} AND "externalCheckoutId" = ${externalCheckoutId}
         LIMIT 1
      `;
      return rows[0] ? checkoutRecord(rows[0]) : null;
    },

    async claim(input: PaymentsSettlementFactClaim) {
      const inserted = await tx.$queryRaw<SettlementFactRow[]>`
        INSERT INTO "PaymentSettlementFact" (
          "id", "providerEventRecordId", "checkoutAttemptId", "provider", "eventId",
          "externalPaymentId", "externalCheckoutId", "commercialReference", "amountMinor",
          "currency", "livemode", "settledAt"
        ) VALUES (
          ${input.id}, ${input.providerEventRecordId}, ${input.checkoutAttemptId}, ${input.provider}, ${input.eventId},
          ${input.externalPaymentId}, ${input.externalCheckoutId}, ${input.commercialReference}, ${input.amountMinor},
          ${input.currency}, ${input.livemode}, ${input.settledAt}
        )
        ON CONFLICT DO NOTHING
        RETURNING "id", "providerEventRecordId", "checkoutAttemptId", "provider", "eventId",
                  "externalPaymentId", "externalCheckoutId", "commercialReference", "amountMinor",
                  "currency", "livemode", "settledAt", "createdAt"
      `;
      if (inserted[0]) return { created: true, record: settlementRecord(inserted[0]) };

      const existing = await tx.$queryRaw<SettlementFactRow[]>`
        SELECT "id", "providerEventRecordId", "checkoutAttemptId", "provider", "eventId",
               "externalPaymentId", "externalCheckoutId", "commercialReference", "amountMinor",
               "currency", "livemode", "settledAt", "createdAt"
          FROM "PaymentSettlementFact"
         WHERE "providerEventRecordId" = ${input.providerEventRecordId}
            OR ("provider" = ${input.provider} AND "externalPaymentId" = ${input.externalPaymentId})
         ORDER BY CASE WHEN "providerEventRecordId" = ${input.providerEventRecordId} THEN 0 ELSE 1 END
         LIMIT 1
      `;
      if (!existing[0]) throw new Error("PAYMENTS_SETTLEMENT_FACT_DISAPPEARED");
      return { created: false, record: settlementRecord(existing[0]) };
    },
  });
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value ?? null;
}

function jsonEquivalent(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function entitlementSnapshot(row: EntitlementRow) {
  return Object.freeze({
    entitlementId: row.id,
    subjectId: row.subjectId,
    resourceId: row.resourceId,
    sourceReference: row.sourceReference,
    status: row.status,
    quantity: Number(row.quantity),
    scopeSnapshot: row.scopeSnapshot,
    grantSnapshot: row.grantSnapshot,
    validFrom: new Date(row.validFrom),
    validUntil: row.validUntil ? new Date(row.validUntil) : null,
    createdAt: new Date(row.createdAt),
  });
}

function createEntitlementsRepository(tx: Prisma.TransactionClient): EntitlementsDurableRightGrantRepository {
  return Object.freeze({
    async grant(input: EntitlementsGrantRepositoryInput): Promise<EntitlementsDurableRightGrantRepositoryResult> {
      const inserted = await tx.$queryRaw<EntitlementRow[]>`
        INSERT INTO "Entitlement" (
          "id", "subjectId", "resourceId", "sourceReference", "status", "quantity",
          "scopeSnapshot", "grantSnapshot", "validFrom", "validUntil"
        ) VALUES (
          ${randomUUID()}, ${input.subjectId}, ${input.resourceId}, ${input.sourceReference}, 'ACTIVE', ${input.quantity},
          ${JSON.stringify(input.scopeSnapshot ?? null)}::jsonb,
          ${JSON.stringify(input.grantSnapshot ?? null)}::jsonb,
          ${input.validFrom}, ${input.validUntil ?? null}
        )
        ON CONFLICT ("sourceReference") DO NOTHING
        RETURNING "id", "subjectId", "resourceId", "sourceReference", "status", "quantity",
                  "scopeSnapshot", "grantSnapshot", "validFrom", "validUntil", "createdAt"
      `;
      if (inserted[0]) return { status: "GRANTED", value: entitlementSnapshot(inserted[0]) };

      const existing = await tx.$queryRaw<EntitlementRow[]>`
        SELECT "id", "subjectId", "resourceId", "sourceReference", "status", "quantity",
               "scopeSnapshot", "grantSnapshot", "validFrom", "validUntil", "createdAt"
          FROM "Entitlement"
         WHERE "sourceReference" = ${input.sourceReference}
         LIMIT 1
      `;
      const row = existing[0];
      if (!row) throw new Error("ENTITLEMENT_SOURCE_DISAPPEARED");
      const same = row.subjectId === input.subjectId
        && row.resourceId === input.resourceId
        && Number(row.quantity) === input.quantity
        && jsonEquivalent(row.scopeSnapshot, input.scopeSnapshot)
        && jsonEquivalent(row.grantSnapshot, input.grantSnapshot)
        && new Date(row.validFrom).getTime() === input.validFrom.getTime()
        && (row.validUntil?.getTime() ?? null) === (input.validUntil?.getTime() ?? null);
      return same
        ? { status: "EXISTING", value: entitlementSnapshot(row) }
        : { status: "REJECTED", code: "SOURCE_CONFLICT" };
    },
  });
}

function createCommerceRepository(tx: Prisma.TransactionClient): CommerceSettlementFulfillmentRepository {
  return Object.freeze({
    async settle(input: CommerceSettlementRepositoryInput) {
      const fulfillmentRows = await tx.$queryRaw<OrderFulfillmentRow[]>`
        SELECT "fulfillmentMode"::text AS "fulfillmentMode", "fulfillmentSnapshot"
          FROM "Order"
         WHERE "id" = ${input.orderId}
         FOR UPDATE
      `;
      const fulfillment = fulfillmentRows[0];
      if (!fulfillment) return { status: "REJECTED" as const, code: "ORDER_NOT_FOUND" as const };
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        include: { items: true, invoice: true, offerRedemption: true },
      });
      if (!order) return { status: "REJECTED" as const, code: "ORDER_NOT_FOUND" as const };
      if (order.totalMinor !== input.expectedAmountMinor || order.currency !== input.expectedCurrency) {
        return { status: "REJECTED" as const, code: "SETTLEMENT_MISMATCH" as const };
      }
      if (order.status !== "PENDING" && order.status !== "PAID" && order.status !== "CANCELLED") {
        return { status: "REJECTED" as const, code: "ORDER_NOT_SETTLEABLE" as const };
      }
      const disposition = order.status === "CANCELLED" ? "AFTER_LOCAL_CANCELLATION" as const : "STANDARD" as const;
      const invoice = order.invoice;
      if (!invoice) throw new Error("COMMERCE_INVOICE_MISSING");
      if (((order.status === "PENDING" || order.status === "CANCELLED") && invoice.status !== "DRAFT")
        || (order.status === "PAID" && invoice.status !== "FINAL")) {
        return { status: "REJECTED" as const, code: "ORDER_NOT_SETTLEABLE" as const };
      }
      const redemption = order.offerRedemption;
      const releasedAfterLocalCancellation = order.status === "CANCELLED" && redemption?.status === "RELEASED";
      if (
        redemption
        && redemption.status !== "RESERVED"
        && redemption.status !== "APPLIED"
        && !releasedAfterLocalCancellation
      ) {
        return { status: "REJECTED" as const, code: "ORDER_NOT_SETTLEABLE" as const };
      }

      if (order.status === "PENDING" || order.status === "CANCELLED") {
        await tx.order.update({ where: { id: order.id }, data: { status: "PAID", paidAt: input.settledAt } });
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: "FINAL", issuedAt: input.settledAt } });
      }
      if (redemption?.status === "RESERVED" || releasedAfterLocalCancellation) {
        await tx.offerRedemption.update({ where: { id: redemption.id }, data: { status: "APPLIED", appliedAt: input.settledAt } });
      }

      return {
        status: "SETTLED" as const,
        value: Object.freeze({
          orderId: order.id,
          invoiceId: invoice.id,
          accountId: order.accountId,
          amountMinor: order.totalMinor,
          currency: order.currency,
          orderStatus: "PAID" as const,
          invoiceStatus: "FINAL" as const,
          settlementDisposition: disposition,
          fulfillmentMode: fulfillment.fulfillmentMode,
          fulfillmentSnapshot: fulfillment.fulfillmentSnapshot,
          items: Object.freeze(order.items.map((item) => Object.freeze({
            orderItemId: item.id,
            productId: item.productId,
            editionId: item.editionId,
            purchasePlanId: item.purchasePlanId,
            quantity: item.quantity,
            entitlementSnapshot: item.entitlementSnapshot,
            policySnapshot: item.policySnapshot,
          }))),
        }),
      };
    },
  });
}

function rejectionCode(code: string): PaymentErrorCode {
  switch (code) {
    case "MODE_MISMATCH": return "PAYMENT_MODE_MISMATCH";
    case "CHECKOUT_MISMATCH": return "PAYMENT_CHECKOUT_MISMATCH";
    case "REFERENCE_MISMATCH": return "PAYMENT_REFERENCE_MISMATCH";
    case "AMOUNT_MISMATCH": return "PAYMENT_AMOUNT_MISMATCH";
    case "CURRENCY_MISMATCH": return "PAYMENT_CURRENCY_MISMATCH";
    case "PAYMENT_REFERENCE_MISSING": return "PAYMENT_REFERENCE_MISMATCH";
    default: return "PAYMENT_RECONCILIATION_REQUIRED";
  }
}

export async function reactToPaidSettlement(
  tx: Prisma.TransactionClient,
  providerEventRecordId: string,
  expectedLivemode: boolean,
) {
  const payments = createPaymentsSettlementFactCapability(createPaymentsRepository(tx));
  const settlement = await payments.reconcile({ providerEventRecordId, expectedLivemode });
  if (settlement.status === "REJECTED") {
    throw new PaymentLifecycleError(rejectionCode(settlement.code));
  }
  if (settlement.status === "FAILED") {
    throw new PaymentLifecycleError("PAYMENT_PROCESSING_RETRYABLE", true);
  }

  const resolvedOrder = await tx.order.findFirst({
    where: {
      OR: [
        { id: settlement.value.commercialReference },
        { number: settlement.value.commercialReference },
      ],
    },
    select: { id: true },
  });
  if (!resolvedOrder) {
    throw new PaymentLifecycleError("PAYMENT_REFERENCE_MISMATCH");
  }

  const entitlements = createEntitlementsDurableRightGrantCapability(createEntitlementsRepository(tx));
  const commerce = createCommerceSettlementFulfillmentCapability({
    payments: Object.freeze({
      async reconcile() {
        return {
          status: "SETTLED" as const,
          value: {
            settlementFactId: settlement.value.settlementFactId,
            commercialReference: resolvedOrder.id,
            amountMinor: settlement.value.amountMinor,
            currency: settlement.value.currency,
            settledAt: settlement.value.settledAt,
          },
        };
      },
    }),
    repository: createCommerceRepository(tx),
    entitlements: Object.freeze({
      async grant(input: CommerceSettlementEntitlementInput) {
        const result = await entitlements.grant(input);
        if (result.status === "GRANTED" || result.status === "EXISTING") return { status: result.status };
        if (result.status === "REJECTED") return { status: "REJECTED" as const };
        return { status: "FAILED" as const };
      },
    }),
    claimUnits: createTransactionalClaimUnitIssuer(tx),
  });

  const result = await commerce.react({ providerEventRecordId, expectedLivemode });
  if (result.status === "REJECTED") {
    throw new PaymentLifecycleError(
      result.code === "ORDER_NOT_FOUND" ? "PAYMENT_REFERENCE_MISMATCH" : "PAYMENT_RECONCILIATION_REQUIRED",
    );
  }
  if (result.status === "FAILED") {
    throw new PaymentLifecycleError("PAYMENT_PROCESSING_RETRYABLE", true);
  }
  return Object.freeze({
    ...result.value,
    paymentSettlementDisposition: settlement.disposition,
  });
}

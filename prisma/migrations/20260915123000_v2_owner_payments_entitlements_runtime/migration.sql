-- Host deployment composition for released owner persistence.
-- Source contracts:
--   @bke/payments 0.6.0 migrations 0001-0006
--   @bke/entitlements 0.1.0 migration 0001
-- Digital Solutions owns deployment HOW; package schemas retain domain ownership.

CREATE TYPE "PaymentCheckoutAttemptStatus" AS ENUM ('CREATING', 'PENDING', 'FAILED');

CREATE TABLE "PaymentCheckoutAttempt" (
  "id" TEXT NOT NULL,
  "sourceReference" TEXT NOT NULL,
  "commercialReference" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "payerSnapshot" JSONB NOT NULL,
  "itemsSnapshot" JSONB NOT NULL,
  "status" "PaymentCheckoutAttemptStatus" NOT NULL DEFAULT 'CREATING',
  "externalCheckoutId" TEXT,
  "checkoutUrl" TEXT,
  "failureCode" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentCheckoutAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentCheckoutAttempt_amountMinor_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "PaymentCheckoutAttempt_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "PaymentCheckoutAttempt_pending_shape_check" CHECK (
    "status" <> 'PENDING' OR ("externalCheckoutId" IS NOT NULL AND "checkoutUrl" IS NOT NULL)
  ),
  CONSTRAINT "PaymentCheckoutAttempt_failed_shape_check" CHECK (
    "status" <> 'FAILED' OR "failureCode" IS NOT NULL
  )
);
CREATE UNIQUE INDEX "PaymentCheckoutAttempt_sourceReference_key" ON "PaymentCheckoutAttempt"("sourceReference");
CREATE UNIQUE INDEX "PaymentCheckoutAttempt_provider_externalCheckoutId_key" ON "PaymentCheckoutAttempt"("provider", "externalCheckoutId");
CREATE INDEX "PaymentCheckoutAttempt_provider_status_idx" ON "PaymentCheckoutAttempt"("provider", "status");
CREATE INDEX "PaymentCheckoutAttempt_createdAt_idx" ON "PaymentCheckoutAttempt"("createdAt");

CREATE TABLE "PaymentProviderEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "eventFingerprint" TEXT NOT NULL,
  "rawType" TEXT,
  "type" TEXT NOT NULL,
  "externalPaymentId" TEXT,
  "externalCheckoutId" TEXT,
  "reference" TEXT,
  "externalRefundId" TEXT,
  "refundStatus" TEXT,
  "amountMinor" INTEGER,
  "currency" TEXT,
  "livemode" BOOLEAN NOT NULL,
  "occurredAt" TIMESTAMPTZ NOT NULL,
  "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentProviderEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentProviderEvent_amountMinor_check" CHECK ("amountMinor" IS NULL OR "amountMinor" >= 0),
  CONSTRAINT "PaymentProviderEvent_currency_check" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "PaymentProviderEvent_type_check" CHECK (
    "type" IN ('payment.paid', 'payment.failed', 'payment.refunded', 'payment.refund.updated', 'unknown')
  ),
  CONSTRAINT "PaymentProviderEvent_refundStatus_check" CHECK (
    "refundStatus" IS NULL OR "refundStatus" IN ('pending', 'succeeded', 'failed')
  )
);
CREATE UNIQUE INDEX "PaymentProviderEvent_provider_eventId_key" ON "PaymentProviderEvent"("provider", "eventId");
CREATE INDEX "PaymentProviderEvent_provider_type_occurredAt_idx" ON "PaymentProviderEvent"("provider", "type", "occurredAt");
CREATE INDEX "PaymentProviderEvent_externalPaymentId_idx" ON "PaymentProviderEvent"("externalPaymentId");
CREATE INDEX "PaymentProviderEvent_externalCheckoutId_idx" ON "PaymentProviderEvent"("externalCheckoutId");
CREATE INDEX "PaymentProviderEvent_reference_idx" ON "PaymentProviderEvent"("reference");
CREATE INDEX "PaymentProviderEvent_receivedAt_idx" ON "PaymentProviderEvent"("receivedAt");

CREATE TABLE "PaymentSettlementFact" (
  "id" TEXT PRIMARY KEY,
  "providerEventRecordId" TEXT NOT NULL UNIQUE,
  "checkoutAttemptId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "externalPaymentId" TEXT NOT NULL,
  "externalCheckoutId" TEXT NOT NULL,
  "commercialReference" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "livemode" BOOLEAN NOT NULL,
  "settledAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentSettlementFact_amountMinor_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "PaymentSettlementFact_currency_check" CHECK (char_length("currency") = 3)
);
CREATE UNIQUE INDEX "PaymentSettlementFact_provider_externalPaymentId_key" ON "PaymentSettlementFact"("provider", "externalPaymentId");
CREATE INDEX "PaymentSettlementFact_checkoutAttemptId_idx" ON "PaymentSettlementFact"("checkoutAttemptId");
CREATE INDEX "PaymentSettlementFact_commercialReference_idx" ON "PaymentSettlementFact"("commercialReference");
CREATE INDEX "PaymentSettlementFact_settledAt_idx" ON "PaymentSettlementFact"("settledAt");

CREATE TYPE "PaymentRefundOperationState" AS ENUM ('CREATING', 'PENDING', 'SUCCEEDED', 'FAILED');
CREATE TABLE "PaymentRefundOperation" (
  "id" TEXT NOT NULL,
  "sourceReference" TEXT NOT NULL,
  "settlementFactId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "externalPaymentId" TEXT NOT NULL,
  "externalRefundId" TEXT,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "state" "PaymentRefundOperationState" NOT NULL DEFAULT 'CREATING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentRefundOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentRefundOperation_amountMinor_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "PaymentRefundOperation_currency_check" CHECK (char_length("currency") = 3 AND "currency" = upper("currency")),
  CONSTRAINT "PaymentRefundOperation_reason_check" CHECK ("reason" IN ('requested_by_customer','duplicate','fraudulent','other'))
);
CREATE UNIQUE INDEX "PaymentRefundOperation_sourceReference_key" ON "PaymentRefundOperation"("sourceReference");
CREATE UNIQUE INDEX "PaymentRefundOperation_provider_externalRefundId_key" ON "PaymentRefundOperation"("provider", "externalRefundId");
CREATE INDEX "PaymentRefundOperation_settlementFactId_idx" ON "PaymentRefundOperation"("settlementFactId");
CREATE INDEX "PaymentRefundOperation_externalPaymentId_idx" ON "PaymentRefundOperation"("externalPaymentId");
CREATE INDEX "PaymentRefundOperation_state_idx" ON "PaymentRefundOperation"("state");
CREATE INDEX "PaymentRefundOperation_createdAt_idx" ON "PaymentRefundOperation"("createdAt");

CREATE TYPE "PaymentReconciliationState" AS ENUM ('MATCHED', 'OPEN', 'ACKNOWLEDGED');
CREATE TABLE "PaymentReconciliationRecord" (
  "id" TEXT NOT NULL,
  "commercialReference" TEXT NOT NULL,
  "settlementFactId" TEXT,
  "provider" TEXT NOT NULL,
  "externalPaymentId" TEXT,
  "classification" TEXT NOT NULL,
  "differences" JSONB NOT NULL,
  "localStatus" TEXT NOT NULL,
  "providerStatus" TEXT,
  "state" "PaymentReconciliationState" NOT NULL DEFAULT 'OPEN',
  "correlationId" TEXT NOT NULL,
  "runById" TEXT NOT NULL,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedById" TEXT,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentReconciliationRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentReconciliationRecord_correlationId_key" ON "PaymentReconciliationRecord"("correlationId");
CREATE INDEX "PaymentReconciliationRecord_commercialReference_createdAt_idx" ON "PaymentReconciliationRecord"("commercialReference", "createdAt");
CREATE INDEX "PaymentReconciliationRecord_settlementFactId_idx" ON "PaymentReconciliationRecord"("settlementFactId");
CREATE INDEX "PaymentReconciliationRecord_provider_externalPaymentId_idx" ON "PaymentReconciliationRecord"("provider", "externalPaymentId");
CREATE INDEX "PaymentReconciliationRecord_state_idx" ON "PaymentReconciliationRecord"("state");

ALTER TYPE "PaymentCheckoutAttemptStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

CREATE TYPE "EntitlementStatus" AS ENUM ('ACTIVE');
CREATE TABLE "Entitlement" (
  "id" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "sourceReference" TEXT NOT NULL,
  "status" "EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
  "quantity" INTEGER NOT NULL,
  "scopeSnapshot" JSONB NOT NULL,
  "grantSnapshot" JSONB NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Entitlement_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "Entitlement_validity_check" CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom")
);
CREATE UNIQUE INDEX "Entitlement_sourceReference_key" ON "Entitlement"("sourceReference");
CREATE INDEX "Entitlement_subjectId_status_idx" ON "Entitlement"("subjectId", "status");
CREATE INDEX "Entitlement_resourceId_status_idx" ON "Entitlement"("resourceId", "status");
CREATE INDEX "Entitlement_validUntil_idx" ON "Entitlement"("validUntil");

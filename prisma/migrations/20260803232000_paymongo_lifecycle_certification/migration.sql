-- Phase 6.2 stores only normalized payment evidence. Raw provider payloads and signatures are intentionally excluded.
ALTER TABLE "WebhookEvent"
  ADD COLUMN "rawEventType" TEXT,
  ADD COLUMN "normalizedData" JSONB,
  ADD COLUMN "lastErrorCode" TEXT,
  ADD COLUMN "mismatchCategory" TEXT,
  ADD COLUMN "processingAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "conflictCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "occurredAt" TIMESTAMP(3),
  ADD COLUMN "orderId" TEXT,
  ADD COLUMN "paymentAttemptId" TEXT,
  ADD COLUMN "paymentId" TEXT,
  ADD COLUMN "providerCheckoutId" TEXT,
  ADD COLUMN "providerPaymentId" TEXT,
  ADD COLUMN "providerRefundId" TEXT,
  ADD COLUMN "resolutionStatus" TEXT NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "resolutionCode" TEXT,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedById" TEXT;

-- Preserve historical mismatch evidence while explicitly identifying that the old schema lacks normalized facts.
UPDATE "WebhookEvent"
SET "lastErrorCode" = 'PAYMENT_RECONCILIATION_REQUIRED',
    "mismatchCategory" = 'HISTORICAL_UNCLASSIFIABLE'
WHERE "status" = 'FAILED' AND "error" = 'PAYMENT_MISMATCH';

CREATE TABLE "RefundOperation" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "externalRefundId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "lastErrorCode" TEXT,
  "requestedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "RefundOperation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentReconciliation" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "paymentId" TEXT,
  "provider" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "differences" JSONB NOT NULL DEFAULT '[]',
  "localStatus" TEXT NOT NULL,
  "providerStatus" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "correlationId" TEXT NOT NULL,
  "lastErrorCode" TEXT,
  "runById" TEXT NOT NULL,
  "acknowledgedById" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefundOperation_idempotencyKey_key" ON "RefundOperation"("idempotencyKey");
CREATE UNIQUE INDEX "RefundOperation_externalRefundId_key" ON "RefundOperation"("externalRefundId");
CREATE INDEX "RefundOperation_orderId_createdAt_idx" ON "RefundOperation"("orderId", "createdAt");
CREATE INDEX "RefundOperation_status_createdAt_idx" ON "RefundOperation"("status", "createdAt");
CREATE UNIQUE INDEX "PaymentReconciliation_correlationId_key" ON "PaymentReconciliation"("correlationId");
CREATE INDEX "PaymentReconciliation_orderId_createdAt_idx" ON "PaymentReconciliation"("orderId", "createdAt");
CREATE INDEX "PaymentReconciliation_status_createdAt_idx" ON "PaymentReconciliation"("status", "createdAt");
CREATE INDEX "PaymentReconciliation_classification_createdAt_idx" ON "PaymentReconciliation"("classification", "createdAt");
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");
CREATE INDEX "WebhookEvent_mismatchCategory_receivedAt_idx" ON "WebhookEvent"("mismatchCategory", "receivedAt");
CREATE INDEX "WebhookEvent_orderId_receivedAt_idx" ON "WebhookEvent"("orderId", "receivedAt");

ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RefundOperation" ADD CONSTRAINT "RefundOperation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundOperation" ADD CONSTRAINT "RefundOperation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundOperation" ADD CONSTRAINT "RefundOperation_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_runById_fkey" FOREIGN KEY ("runById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

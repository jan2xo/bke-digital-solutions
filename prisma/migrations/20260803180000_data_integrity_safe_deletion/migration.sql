-- Phase 6.1 is forward-only. Retention policy values are intentionally not inferred.
CREATE TYPE "CustomerLifecycleState" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSURE_REQUESTED', 'CLOSED', 'PRIVACY_REVIEW', 'PSEUDONYMIZED', 'PURGE_ELIGIBLE');
CREATE TYPE "StorageCleanupStatus" AS ENUM ('PENDING', 'PROCESSING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "StorageCleanupJobType" AS ENUM ('PRODUCT_DELETION', 'ARTIFACT_REPLACEMENT', 'ARTIFACT_REMOVAL', 'ABANDONED_UPLOAD', 'ORPHANED_OBJECT');
ALTER TYPE "SecurityEventType" ADD VALUE 'CUSTOMER_LIFECYCLE_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE 'CUSTOMER_PURGE_EXECUTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'STORAGE_CLEANUP_FAILED';

ALTER TABLE "User"
  ADD COLUMN "lifecycleState" "CustomerLifecycleState" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "privacyRequestedAt" TIMESTAMP(3),
  ADD COLUMN "pseudonymizedAt" TIMESTAMP(3),
  ADD COLUMN "retentionExpiresAt" TIMESTAMP(3),
  ADD COLUMN "legalHoldAt" TIMESTAMP(3),
  ADD COLUMN "legalHoldReason" TEXT,
  ADD COLUMN "emailHash" TEXT;

ALTER TABLE "CustomerAccount"
  ADD COLUMN "lifecycleState" "CustomerLifecycleState" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "closureRequestedAt" TIMESTAMP(3),
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "privacyRequestedAt" TIMESTAMP(3),
  ADD COLUMN "pseudonymizedAt" TIMESTAMP(3),
  ADD COLUMN "retentionExpiresAt" TIMESTAMP(3),
  ADD COLUMN "legalHoldAt" TIMESTAMP(3),
  ADD COLUMN "legalHoldReason" TEXT;

ALTER TABLE "Product" ADD COLUMN "deletionRequestedAt" TIMESTAMP(3);

-- Audit evidence survives subject/account purge through nullable references.
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actorId_fkey";
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_accountId_fkey";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StorageCleanupJob" (
  "id" TEXT NOT NULL,
  "type" "StorageCleanupJobType" NOT NULL,
  "status" "StorageCleanupStatus" NOT NULL DEFAULT 'PENDING',
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastErrorCode" TEXT,
  "correlationId" TEXT NOT NULL,
  "productId" TEXT,
  "artifactId" TEXT,
  "createdByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "StorageCleanupJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StorageCleanupJob_idempotencyKey_key" ON "StorageCleanupJob"("idempotencyKey");
CREATE INDEX "User_lifecycleState_idx" ON "User"("lifecycleState");
CREATE INDEX "User_retentionExpiresAt_idx" ON "User"("retentionExpiresAt");
CREATE INDEX "User_legalHoldAt_idx" ON "User"("legalHoldAt");
CREATE INDEX "CustomerAccount_lifecycleState_idx" ON "CustomerAccount"("lifecycleState");
CREATE INDEX "CustomerAccount_closedAt_idx" ON "CustomerAccount"("closedAt");
CREATE INDEX "CustomerAccount_retentionExpiresAt_idx" ON "CustomerAccount"("retentionExpiresAt");
CREATE INDEX "CustomerAccount_legalHoldAt_idx" ON "CustomerAccount"("legalHoldAt");
CREATE INDEX "Product_deletionRequestedAt_idx" ON "Product"("deletionRequestedAt");
CREATE INDEX "StorageCleanupJob_status_nextAttemptAt_idx" ON "StorageCleanupJob"("status", "nextAttemptAt");
CREATE INDEX "StorageCleanupJob_targetType_targetId_idx" ON "StorageCleanupJob"("targetType", "targetId");
CREATE INDEX "StorageCleanupJob_productId_status_idx" ON "StorageCleanupJob"("productId", "status");
CREATE INDEX "StorageCleanupJob_artifactId_status_idx" ON "StorageCleanupJob"("artifactId", "status");

ALTER TABLE "StorageCleanupJob" ADD CONSTRAINT "StorageCleanupJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StorageCleanupJob" ADD CONSTRAINT "StorageCleanupJob_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "ProductArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StorageCleanupJob" ADD CONSTRAINT "StorageCleanupJob_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

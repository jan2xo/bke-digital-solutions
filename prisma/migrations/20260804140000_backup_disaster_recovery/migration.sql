CREATE TYPE "BackupArchiveStatus" AS ENUM ('PENDING', 'CREATING', 'AVAILABLE', 'VERIFIED', 'INCOMPLETE', 'CORRUPT', 'FAILED', 'EXPIRED', 'DELETED');
CREATE TYPE "BackupRetentionTier" AS ENUM ('MANUAL', 'DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "BackupOperationType" AS ENUM ('CREATE', 'VERIFY', 'SIMULATE_RESTORE', 'RESTORE_ISOLATED', 'DELETE_EXPIRED');
CREATE TYPE "BackupOperationStatus" AS ENUM ('PENDING', 'PROCESSING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "BackupOperationTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'CLI');

CREATE TABLE "BackupArchive" (
  "id" TEXT NOT NULL,
  "status" "BackupArchiveStatus" NOT NULL DEFAULT 'PENDING',
  "retentionTier" "BackupRetentionTier" NOT NULL,
  "deploymentId" TEXT NOT NULL,
  "formatVersion" INTEGER NOT NULL DEFAULT 1,
  "storagePrefix" TEXT NOT NULL,
  "manifestObjectKey" TEXT,
  "manifestChecksum" TEXT,
  "databaseObjectKey" TEXT,
  "databaseChecksum" TEXT,
  "encryptedChecksum" TEXT,
  "encryptionKeyVersion" INTEGER,
  "objectCount" INTEGER NOT NULL DEFAULT 0,
  "missingObjectCount" INTEGER NOT NULL DEFAULT 0,
  "sizeBytes" BIGINT NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BackupArchive_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BackupOperation" (
  "id" TEXT NOT NULL,
  "backupId" TEXT,
  "type" "BackupOperationType" NOT NULL,
  "status" "BackupOperationStatus" NOT NULL DEFAULT 'PENDING',
  "trigger" "BackupOperationTrigger" NOT NULL,
  "requestedById" TEXT,
  "dryRun" BOOLEAN NOT NULL DEFAULT false,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "claimedBy" TEXT,
  "correlationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "targetFingerprint" TEXT,
  "resultSummary" JSONB NOT NULL DEFAULT '{}',
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BackupOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BackupArchive_storagePrefix_key" ON "BackupArchive"("storagePrefix");
CREATE INDEX "BackupArchive_status_createdAt_idx" ON "BackupArchive"("status", "createdAt");
CREATE INDEX "BackupArchive_expiresAt_status_idx" ON "BackupArchive"("expiresAt", "status");
CREATE INDEX "BackupArchive_deploymentId_createdAt_idx" ON "BackupArchive"("deploymentId", "createdAt");
CREATE UNIQUE INDEX "BackupOperation_correlationId_key" ON "BackupOperation"("correlationId");
CREATE UNIQUE INDEX "BackupOperation_idempotencyKey_key" ON "BackupOperation"("idempotencyKey");
CREATE INDEX "BackupOperation_status_nextAttemptAt_idx" ON "BackupOperation"("status", "nextAttemptAt");
CREATE INDEX "BackupOperation_backupId_createdAt_idx" ON "BackupOperation"("backupId", "createdAt");
CREATE INDEX "BackupOperation_requestedById_createdAt_idx" ON "BackupOperation"("requestedById", "createdAt");

ALTER TABLE "BackupOperation" ADD CONSTRAINT "BackupOperation_backupId_fkey" FOREIGN KEY ("backupId") REFERENCES "BackupArchive"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BackupOperation" ADD CONSTRAINT "BackupOperation_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

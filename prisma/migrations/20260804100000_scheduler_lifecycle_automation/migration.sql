CREATE TYPE "ScheduledJobRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRYING', 'ABANDONED', 'CANCELLED', 'SKIPPED');
CREATE TYPE "ScheduledJobTrigger" AS ENUM ('SCHEDULED', 'RETRY', 'MANUAL', 'CRON', 'CLI', 'CERTIFICATION');

CREATE TABLE "ScheduledJobDefinition" (
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "cadenceSeconds" INTEGER NOT NULL,
  "timeoutSeconds" INTEGER NOT NULL,
  "maxAttempts" INTEGER NOT NULL,
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "lastRunAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduledJobDefinition_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "ScheduledJobRun" (
  "id" TEXT NOT NULL,
  "jobKey" TEXT NOT NULL,
  "status" "ScheduledJobRunStatus" NOT NULL DEFAULT 'QUEUED',
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "trigger" "ScheduledJobTrigger" NOT NULL,
  "dryRun" BOOLEAN NOT NULL DEFAULT false,
  "lockOwner" TEXT,
  "correlationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "parentRunId" TEXT,
  "retryAt" TIMESTAMP(3),
  "resultSummary" JSONB NOT NULL DEFAULT '{}',
  "errorCode" TEXT,
  "failureClass" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduledJobRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScheduledJobRun_correlationId_key" ON "ScheduledJobRun"("correlationId");
CREATE UNIQUE INDEX "ScheduledJobRun_idempotencyKey_key" ON "ScheduledJobRun"("idempotencyKey");
CREATE INDEX "ScheduledJobDefinition_enabled_nextRunAt_idx" ON "ScheduledJobDefinition"("enabled", "nextRunAt");
CREATE INDEX "ScheduledJobDefinition_consecutiveFailures_lastFailureAt_idx" ON "ScheduledJobDefinition"("consecutiveFailures", "lastFailureAt");
CREATE INDEX "ScheduledJobRun_jobKey_createdAt_idx" ON "ScheduledJobRun"("jobKey", "createdAt");
CREATE INDEX "ScheduledJobRun_status_retryAt_idx" ON "ScheduledJobRun"("status", "retryAt");
CREATE INDEX "ScheduledJobRun_status_startedAt_idx" ON "ScheduledJobRun"("status", "startedAt");

ALTER TABLE "ScheduledJobRun" ADD CONSTRAINT "ScheduledJobRun_jobKey_fkey" FOREIGN KEY ("jobKey") REFERENCES "ScheduledJobDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScheduledJobRun" ADD CONSTRAINT "ScheduledJobRun_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductArtifact" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

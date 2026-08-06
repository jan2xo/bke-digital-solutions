CREATE TYPE "ObservabilityAlertSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');
CREATE TYPE "ObservabilityAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "ObservabilityAlert" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "severity" "ObservabilityAlertSeverity" NOT NULL,
    "status" "ObservabilityAlertStatus" NOT NULL DEFAULT 'OPEN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "resolvedById" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "ObservabilityAlert_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ObservabilityAlert_fingerprint_status_key" ON "ObservabilityAlert"("fingerprint", "status");
CREATE INDEX "ObservabilityAlert_status_severity_lastSeenAt_idx" ON "ObservabilityAlert"("status", "severity", "lastSeenAt");
CREATE INDEX "ObservabilityAlert_source_lastSeenAt_idx" ON "ObservabilityAlert"("source", "lastSeenAt");
ALTER TABLE "ObservabilityAlert" ADD CONSTRAINT "ObservabilityAlert_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ObservabilityAlert" ADD CONSTRAINT "ObservabilityAlert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

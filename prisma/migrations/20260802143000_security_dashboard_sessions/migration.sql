CREATE TYPE "SecurityEventOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'BLOCKED', 'INFORMATIONAL');
CREATE TYPE "SecurityEventSeverity" AS ENUM ('INFORMATIONAL', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "SessionAuthenticationMethod" AS ENUM ('PASSWORD', 'PASSWORD_TOTP', 'PASSWORD_RECOVERY', 'MAGIC_LINK', 'MFA_ENROLLMENT');
CREATE TYPE "SessionAssuranceLevel" AS ENUM ('BASIC', 'MFA_VERIFIED', 'RECENTLY_AUTHENTICATED');

ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_LOGIN_SUCCEEDED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_LOGIN_FAILED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_PASSWORD_REJECTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_SESSION_CREATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'PASSWORD_RESET_COMPLETED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_ALL_OTHER_SESSIONS_REVOKED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_ALL_SESSIONS_REVOKED';
ALTER TYPE "SecurityEventType" ADD VALUE 'SECURITY_RATE_LIMIT_TRIGGERED';
ALTER TYPE "SecurityEventType" ADD VALUE 'PROVIDER_CREDENTIAL_REPLACED';
ALTER TYPE "SecurityEventType" ADD VALUE 'PROVIDER_CREDENTIAL_REVOKED';
ALTER TYPE "SecurityEventType" ADD VALUE 'PROVIDER_VALIDATION_SUCCEEDED';
ALTER TYPE "SecurityEventType" ADD VALUE 'PROVIDER_VALIDATION_FAILED';
ALTER TYPE "SecurityEventType" ADD VALUE 'LIVE_PAYMENT_ENABLE_BLOCKED';

ALTER TABLE "Session"
  ADD COLUMN "userAgentSummary" TEXT,
  ADD COLUMN "networkHint" TEXT,
  ADD COLUMN "authenticationMethod" "SessionAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD',
  ADD COLUMN "assuranceLevel" "SessionAssuranceLevel" NOT NULL DEFAULT 'BASIC',
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revocationReason" TEXT;

UPDATE "Session" SET "userAgentSummary" = 'Previously recorded session' WHERE "userAgentSummary" IS NULL;

ALTER TABLE "SecurityEvent"
  ADD COLUMN "outcome" "SecurityEventOutcome" NOT NULL DEFAULT 'INFORMATIONAL',
  ADD COLUMN "severity" "SecurityEventSeverity" NOT NULL DEFAULT 'INFORMATIONAL',
  ADD COLUMN "sessionId" TEXT,
  ADD COLUMN "provider" "ExternalProvider",
  ADD COLUMN "authenticationMethod" "SessionAuthenticationMethod";

ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailOutbox" ADD COLUMN "deduplicationKey" TEXT;

CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");
CREATE INDEX "Session_userId_absoluteExpiresAt_idx" ON "Session"("userId", "absoluteExpiresAt");
CREATE INDEX "Session_userId_lastSeenAt_idx" ON "Session"("userId", "lastSeenAt");
CREATE INDEX "SecurityEvent_severity_createdAt_idx" ON "SecurityEvent"("severity", "createdAt");
CREATE INDEX "SecurityEvent_outcome_createdAt_idx" ON "SecurityEvent"("outcome", "createdAt");
CREATE INDEX "SecurityEvent_provider_createdAt_idx" ON "SecurityEvent"("provider", "createdAt");
CREATE UNIQUE INDEX "EmailOutbox_deduplicationKey_key" ON "EmailOutbox"("deduplicationKey");

ALTER TABLE "EmailOutbox" ADD COLUMN "claimedBy" TEXT;
ALTER TABLE "EmailOutbox" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "EmailOutbox" ADD COLUMN "claimExpiresAt" TIMESTAMP(3);

CREATE INDEX "EmailOutbox_status_claimExpiresAt_idx" ON "EmailOutbox"("status", "claimExpiresAt");

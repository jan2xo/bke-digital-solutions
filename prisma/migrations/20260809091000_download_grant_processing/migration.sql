ALTER TABLE "DownloadGrant" ADD COLUMN "processingAt" TIMESTAMP(3);
CREATE INDEX "DownloadGrant_processingAt_idx" ON "DownloadGrant"("processingAt");

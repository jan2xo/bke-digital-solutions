ALTER TABLE "ReleaseApproval" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "ReleaseApproval" ADD COLUMN "payloadHash" TEXT;
CREATE INDEX "ReleaseApproval_versionId_payloadHash_createdAt_idx" ON "ReleaseApproval"("versionId", "payloadHash", "createdAt");

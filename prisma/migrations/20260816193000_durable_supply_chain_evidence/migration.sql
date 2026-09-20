ALTER TABLE "SupplyChainVerificationEvidence" ADD COLUMN "documentObjectKey" TEXT;
ALTER TABLE "SupplyChainVerificationEvidence" ADD COLUMN "documentSha256" TEXT;
CREATE INDEX "SupplyChainVerificationEvidence_documentObjectKey_idx" ON "SupplyChainVerificationEvidence"("documentObjectKey");

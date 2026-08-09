CREATE TABLE "SupplyChainVerificationEvidence" (
  "id" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "artifactHash" TEXT NOT NULL,
  "signerKeyId" TEXT,
  "scannerId" TEXT,
  "scannerVersion" TEXT,
  "result" TEXT NOT NULL,
  "reference" TEXT,
  "failureReason" TEXT,
  "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "SupplyChainVerificationEvidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupplyChainVerificationEvidence_evidenceId_kind_verifiedAt_idx" ON "SupplyChainVerificationEvidence"("evidenceId", "kind", "verifiedAt");
ALTER TABLE "SupplyChainVerificationEvidence" ADD CONSTRAINT "SupplyChainVerificationEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "SupplyChainEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

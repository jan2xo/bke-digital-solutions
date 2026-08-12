ALTER TABLE "SupplyChainEvidence"
  ADD COLUMN "canonicalPayloadHash" TEXT,
  ADD COLUMN "signatureAlgorithm" TEXT,
  ADD COLUMN "signatureKeyId" TEXT,
  ADD COLUMN "signedAt" TIMESTAMP(3);

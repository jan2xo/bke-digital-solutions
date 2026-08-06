CREATE TABLE "SupplyChainEvidence" (
  "id" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "releaseIdentifier" TEXT NOT NULL,
  "commitHash" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "buildEnvironment" TEXT NOT NULL,
  "builderIdentity" TEXT NOT NULL,
  "builtAt" TIMESTAMP(3) NOT NULL,
  "manifestJson" JSONB NOT NULL DEFAULT '{}',
  "sbomReference" TEXT,
  "sbomFormat" TEXT,
  "manifestSignature" TEXT,
  "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
  "dependencyVerified" BOOLEAN NOT NULL DEFAULT false,
  "malwareStatus" TEXT NOT NULL DEFAULT 'PENDING_SCAN',
  "certificateStatus" TEXT NOT NULL DEFAULT 'PENDING_PROVISIONING',
  "provenanceStatus" TEXT NOT NULL DEFAULT 'RECORDED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplyChainEvidence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupplyChainEvidence_versionId_key" ON "SupplyChainEvidence"("versionId");
CREATE INDEX "SupplyChainEvidence_malwareStatus_certificateStatus_idx" ON "SupplyChainEvidence"("malwareStatus", "certificateStatus");
ALTER TABLE "SupplyChainEvidence" ADD CONSTRAINT "SupplyChainEvidence_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProductVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

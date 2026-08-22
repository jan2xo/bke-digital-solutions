CREATE TYPE "CommissioningStatus" AS ENUM ('PENDING', 'VERIFYING', 'ANALYZING', 'EVIDENCE_READY', 'FAILED', 'SUPERSEDED');

CREATE TABLE "CommissioningRun" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "artifactSha256" TEXT NOT NULL,
  "artifactSizeBytes" BIGINT NOT NULL,
  "payloadHash" TEXT,
  "policyVersion" TEXT NOT NULL,
  "generatorVersion" TEXT NOT NULL,
  "status" "CommissioningStatus" NOT NULL DEFAULT 'PENDING',
  "classification" TEXT NOT NULL,
  "sbomStatus" TEXT NOT NULL DEFAULT 'UNDETERMINED',
  "dependencyStatus" TEXT NOT NULL DEFAULT 'UNDETERMINED',
  "migrationCategory" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "migrationStatus" TEXT NOT NULL DEFAULT 'UNDETERMINED',
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "limitations" JSONB NOT NULL DEFAULT '[]',
  "errorCode" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommissioningRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommissioningRun_identity_key" ON "CommissioningRun"("artifactId", "artifactSha256", "payloadHash", "policyVersion", "generatorVersion");
CREATE INDEX "CommissioningRun_status_createdAt_idx" ON "CommissioningRun"("status", "createdAt");
CREATE INDEX "CommissioningRun_versionId_status_idx" ON "CommissioningRun"("versionId", "status");
ALTER TABLE "CommissioningRun" ADD CONSTRAINT "CommissioningRun_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissioningRun" ADD CONSTRAINT "CommissioningRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProductVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissioningRun" ADD CONSTRAINT "CommissioningRun_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "ProductArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

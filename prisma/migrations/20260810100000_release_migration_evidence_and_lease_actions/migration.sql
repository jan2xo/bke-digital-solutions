ALTER TABLE "ProductVersion" ADD COLUMN "migrationEvidence" TEXT;
ALTER TABLE "LicenseLeaseRecord" ADD COLUMN "action" TEXT NOT NULL DEFAULT 'ACTIVATION';

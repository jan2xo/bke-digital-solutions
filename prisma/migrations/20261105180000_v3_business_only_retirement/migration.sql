-- V3: GitHub owns public software assets. Prisma owns business and licensing data.
-- Forward-only migration. Fail closed on legacy records; do not discard evidence.
-- Guard and destructive DDL must be atomic, including under concurrent legacy writes.
BEGIN;
-- Avoid an unbounded wait if a live writer still holds one of these tables.
SET LOCAL lock_timeout = '5s';
-- Lock all destructive targets before checking emptiness; retain locks through DROP.
LOCK TABLE
  "DownloadGrant",
  "CommissioningRun",
  "StorageCleanupJob",
  "ArtifactUploadSession",
  "SupplyChainVerificationEvidence",
  "SupplyChainEvidence",
  "ReleaseApproval",
  "ProductArtifact",
  "ProductVersion"
IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE
  table_name text;
  has_records boolean;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'DownloadGrant', 'CommissioningRun', 'StorageCleanupJob',
    'ArtifactUploadSession', 'SupplyChainVerificationEvidence',
    'SupplyChainEvidence', 'ReleaseApproval', 'ProductArtifact'
  ] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', table_name) INTO has_records;
    IF has_records THEN
      RAISE EXCEPTION 'V3_LEGACY_TABLE_NONEMPTY: %', table_name;
    END IF;
  END LOOP;

  -- These legacy release-evidence fields are not part of V3's business catalog.
  -- A non-null value is historical evidence and must never be silently dropped.
  IF EXISTS (
    SELECT 1 FROM "ProductVersion"
     WHERE "backupEvidence" IS NOT NULL
        OR "complianceEvidence" IS NOT NULL
        OR "migrationEvidence" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'V3_LEGACY_RELEASE_EVIDENCE_NONEMPTY';
  END IF;
END $$;

DROP TABLE "DownloadGrant";
DROP TABLE "CommissioningRun";
DROP TABLE "StorageCleanupJob";
DROP TABLE "ArtifactUploadSession";
DROP TABLE "SupplyChainVerificationEvidence";
DROP TABLE "SupplyChainEvidence";
DROP TABLE "ReleaseApproval";
DROP TABLE "ProductArtifact";

ALTER TABLE "ProductVersion"
  DROP COLUMN "backupEvidence",
  DROP COLUMN "complianceEvidence",
  DROP COLUMN "migrationEvidence";

DROP TYPE "ArtifactUploadState";
DROP TYPE "CommissioningStatus";
DROP TYPE "StorageCleanupJobType";
DROP TYPE "StorageCleanupStatus";

COMMIT;

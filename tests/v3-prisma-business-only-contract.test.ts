import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/20261105180000_v3_business_only_retirement/migration.sql");

describe("V3 central licensing and GitHub distribution authority", () => {
  it("keeps the licensing server and commercial records in Digital Solutions", () => {
    for (const model of [
      "License", "LicensePolicy", "LicenseLeaseRecord", "CommercialLeaseOperation",
      "CommercialSigningKey", "LicenseAssignment", "DeviceActivation", "LicenseEvent",
      "TrialGrant", "User", "CustomerAccount", "Product", "ProductVersion", "Order",
      "OrderItem", "Payment", "Invoice", "Subscription", "AuditLog",
      "ComplianceRequirement", "ComplianceEvidence",
    ]) {
      expect(schema, model).toContain(`model ${model} {`);
    }
    const release = read("platform/distribution/github-releases.ts");
    expect(release).toContain("githubReleaseRepository");
    expect(read("app/api/licenses/[id]/download/route.ts")).toContain("githubLatestReleaseUrl");
  });

  it("removes only obsolete software storage, upload and release-certification tables", () => {
    for (const model of [
      "DownloadGrant", "ProductArtifact", "ArtifactUploadSession", "CommissioningRun",
      "SupplyChainEvidence", "SupplyChainVerificationEvidence", "ReleaseApproval",
      "StorageCleanupJob",
    ]) {
      expect(schema).not.toContain(`model ${model} {`);
      expect(migration).toContain(`DROP TABLE "${model}"`);
      expect(migration).toContain(`'${model}'`);
    }
    expect(migration).toContain("V3_LEGACY_TABLE_NONEMPTY");
    expect(migration).toContain("SELECT EXISTS");
    expect(migration).toContain("END $$;");
    for (const retiredColumn of ["backupEvidence", "complianceEvidence", "migrationEvidence"]) {
      expect(migration).toContain(`"${retiredColumn}" IS NOT NULL`);
    }
    expect(migration).toContain("V3_LEGACY_RELEASE_EVIDENCE_NONEMPTY");
    expect(existsSync("apps/web/storage/cleanup.ts")).toBe(false);
    expect(existsSync("apps/web/storage/object-storage.ts")).toBe(false);
  });

  it("makes guarded destructive DDL atomic under concurrent legacy writes", () => {
    const begin = migration.indexOf("BEGIN;");
    const lock = migration.indexOf("LOCK TABLE");
    const guard = migration.indexOf("DO $");
    const drop = migration.indexOf('DROP TABLE "DownloadGrant"');
    const commit = migration.lastIndexOf("COMMIT;");
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(lock).toBeGreaterThan(begin);
    expect(guard).toBeGreaterThan(lock);
    expect(drop).toBeGreaterThan(guard);
    expect(commit).toBeGreaterThan(drop);
    expect(migration).toContain("SET LOCAL lock_timeout = '5s';");
    const lockClause = migration.slice(lock, guard);
    expect(lockClause).toContain("IN ACCESS EXCLUSIVE MODE;");
    for (const target of [
      "DownloadGrant", "CommissioningRun", "StorageCleanupJob", "ArtifactUploadSession",
      "SupplyChainVerificationEvidence", "SupplyChainEvidence", "ReleaseApproval",
      "ProductArtifact", "ProductVersion",
    ]) {
      expect(lockClause).toContain(`"${target}"`);
    }
  });

  it("does not require product object storage for application readiness", () => {
    const host = read("platform/host/config/environment.ts");
    const health = read("apps/web/health/readiness.ts");
    expect(host).not.toContain("S3_BUCKET:");
    expect(host).not.toContain("MAX_ARTIFACT_BYTES");
    expect(health).not.toContain("checkObjectStorage");
    for (const dependency of ["postgresql", "valkey", "providers"]) {
      expect(health).toContain(`${dependency}:`);
    }
  });

  it("preserves private database backup encryption without copying public GitHub releases", () => {
    const backup = read("lib/backups/engine.ts");
    expect(backup).toContain("pg_dump");
    expect(backup).toContain("BACKUP_ENCRYPTION_KEY");
    expect(backup).toContain("LEGACY_OBJECT_BACKUP_RESTORE_UNSUPPORTED");
    expect(backup).not.toContain("db.productArtifact");
    expect(backup).not.toContain("sourceClient(");
  });
});

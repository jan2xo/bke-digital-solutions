import { describe, expect, it } from "vitest";
import { assertIsolatedRestoreTargets, encryptedObjectKey, reconcileSourceObjects } from "@/lib/backups/recovery-safety";

const safe = {
  sourceDatabaseUrl: "postgresql://source:pass@source.pg.test:5432/bke_production",
  targetDatabaseUrl: "postgresql://target:pass@isolated.pg.test:5432/bke_restore",
  sourceBucket: "bke-private",
  backupBucket: "bke-backups",
  targetBucket: "bke-restore",
  sourceAccessKeyId: "source-credentials",
  backupAccessKeyId: "backup-credentials",
  targetAccessKeyId: "restore-credentials",
  production: true,
} as const;

describe("independent private-object backup and isolated restore", () => {
  it("preserves extension-safe source object keys under opaque encrypted archive keys", () => {
    const first = encryptedObjectKey("deployment/backup-1", "evidence/v1/provenance/uuid.json");
    expect(first).toMatch(/^deployment\/backup-1\/objects\/[a-f0-9]{64}\.enc$/);
    expect(first).toBe(encryptedObjectKey("deployment/backup-1", "evidence/v1/provenance/uuid.json"));
    expect(first).not.toContain("provenance/");
    expect(encryptedObjectKey("deployment/backup-1", "artifacts/v1/release.zip")).not.toBe(first);
  });

  it("detects missing database-referenced private assets without ignoring other stored objects", () => {
    expect(reconcileSourceObjects(["assets/installer.bin", "evidence/sbom.json"], [
      "assets/installer.bin", "images/missing.png",
    ])).toEqual({
      sourceKeys: ["assets/installer.bin", "evidence/sbom.json"],
      missingKeys: ["images/missing.png"],
    });
    expect(() => reconcileSourceObjects(["a", "a"], [])).toThrow("BACKUP_OBJECT_LIST_DUPLICATE");
    expect(() => reconcileSourceObjects([""], [])).toThrow("BACKUP_OBJECT_KEY_INVALID");
  });

  it("refuses source DB, production alias, non-isolated storage or reused production credentials", () => {
    expect(() => assertIsolatedRestoreTargets(safe)).not.toThrow();
    expect(() => assertIsolatedRestoreTargets({ ...safe, targetDatabaseUrl: safe.sourceDatabaseUrl }))
      .toThrow("RESTORE_TARGET_NOT_ISOLATED");
    expect(() => assertIsolatedRestoreTargets({
      ...safe, targetDatabaseUrl: "postgresql://other@isolated.pg.test/bke_production",
    })).toThrow("RESTORE_TARGET_NOT_ISOLATED");
    expect(() => assertIsolatedRestoreTargets({
      ...safe, targetDatabaseUrl: "postgresql://other@source.pg.test/bke_restore",
    })).toThrow("RESTORE_DATABASE_HOST_NOT_ISOLATED");
    expect(() => assertIsolatedRestoreTargets({ ...safe, targetBucket: safe.backupBucket }))
      .toThrow("RESTORE_BUCKET_NOT_ISOLATED");
    expect(() => assertIsolatedRestoreTargets({ ...safe, targetAccessKeyId: safe.sourceAccessKeyId }))
      .toThrow("RESTORE_CREDENTIALS_NOT_ISOLATED");
  });

  it("allows disposable same-host local certification only when production=false", () => {
    expect(() => assertIsolatedRestoreTargets({
      ...safe, production: false, targetDatabaseUrl: "postgresql://target@source.pg.test/bke_restore",
      targetAccessKeyId: safe.sourceAccessKeyId,
    })).not.toThrow();
  });
});

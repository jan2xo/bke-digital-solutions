import { describe, expect, it } from "vitest";
import { backupManifestSchema, canonicalJson, decryptBuffer, encryptBuffer, missingObjects, sha256, verifyManifest } from "@/lib/backups/integrity";
import { expiresAt, retentionTier, retryAt, validateRestoreConfirmation } from "@/lib/backups/policy";

const key = Buffer.alloc(32, 7);

describe("backup integrity", () => {
  it("encrypts, authenticates, and detects corruption", () => {
    const original = Buffer.from("recoverable BKE data");
    const encrypted = encryptBuffer(original, key);
    expect(decryptBuffer(encrypted.encrypted, key, encrypted.iv, encrypted.authTag)).toEqual(original);
    const corrupt = Buffer.from(encrypted.encrypted); corrupt[0] ^= 1;
    expect(() => decryptBuffer(corrupt, key, encrypted.iv, encrypted.authTag)).toThrow();
  });

  it("canonicalizes and verifies manifests", () => {
    const artifact = { sourceKey: "postgresql", backupKey: "b/db.enc", sizeBytes: 3, encryptedSizeBytes: 3, sha256: sha256("one"), encryptedSha256: sha256("two"), iv: "AAAAAAAAAAAAAAAA", authTag: "AAAAAAAAAAAAAAAA" };
    const manifest = backupManifestSchema.parse({ formatVersion: 1, backupId: "b1", deploymentId: "test", createdAt: new Date().toISOString(), retentionTier: "DAILY", database: artifact, objects: [], missingSourceObjects: [], migrations: ["m1"], tableCounts: { users: 1 }, runtime: { nodeVersion: "v22", paymentProvider: "mock", emailProvider: "log", providerConfigSource: "environment", sourceBucket: "source" } });
    const checksum = sha256(canonicalJson(manifest));
    expect(verifyManifest(manifest, checksum).checksumMatches).toBe(true);
    expect(verifyManifest({ ...manifest, deploymentId: "tampered" }, checksum).checksumMatches).toBe(false);
  });

  it("detects referenced objects missing from storage", () => {
    expect(missingObjects(["installer/a", "images/b", "installer/a"], ["installer/a", "orphan/c"])).toEqual(["images/b"]);
  });
});

describe("backup retention and restore policy", () => {
  it("assigns monthly, weekly, and daily tiers", () => {
    expect(retentionTier(new Date("2026-08-01T00:00:00Z"))).toBe("MONTHLY");
    expect(retentionTier(new Date("2026-08-02T00:00:00Z"))).toBe("WEEKLY");
    expect(retentionTier(new Date("2026-08-03T00:00:00Z"))).toBe("DAILY");
  });
  it("calculates retention and bounded exponential retry", () => {
    const now = new Date("2026-08-03T00:00:00Z");
    expect(expiresAt("DAILY", now, { daily: 7, weekly: 4, monthly: 12 })?.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    expect(expiresAt("MANUAL", now, { daily: 7, weekly: 4, monthly: 12 })).toBeNull();
    expect(retryAt(2, now).getTime() - now.getTime()).toBe(60_000);
  });
  it("requires an exact archive-bound restore confirmation", () => {
    expect(validateRestoreConfirmation("b1", "RESTORE TO ISOLATED TARGET b1")).toBe(true);
    expect(validateRestoreConfirmation("b1", "RESTORE TO ISOLATED TARGET b2")).toBe(false);
  });
});

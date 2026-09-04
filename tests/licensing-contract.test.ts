import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

Object.assign(process.env, { APP_URL: "http://localhost:3000", DATABASE_URL: "postgresql://test:test@postgres:5432/test", SESSION_SECRET: "test-session-secret-abcdefghijklmnopqrstuvwxyz-123456", LICENSE_PEPPER: "test-license-pepper-abcdefghijklmnopqrstuvwxyz-123456", CRON_SECRET: "test-cron-secret-abcdefghijklmnopqrstuvwxyz-123456", S3_BUCKET: "test-bucket", EMAIL_FROM: "test@example.com", NODE_ENV: "test" });

describe("Digital Solutions identity and Cloud-Agent contract", () => {
  it("derives stable commercial device identity without exposing raw storage semantics", async () => {
    const { deviceIdentity } = await import("@/lib/licensing/product-identity");
    const first = deviceIdentity("device-identity-123456");
    const second = deviceIdentity("  device-identity-123456  ");
    expect(second).toEqual(first);
    expect(first.deviceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.machineIdHint).toBe("y-123456");
  });

  it("rejects short device identifiers", async () => {
    const { deviceIdentity } = await import("@/lib/licensing/product-identity");
    expect(() => deviceIdentity("short")).toThrow("INVALID_DEVICE_ID");
  });

  it("canonicalizes Unicode identities and rejects control characters", async () => {
    const { canonicalIdentity } = await import("@/lib/licensing/product-identity");
    expect(canonicalIdentity("  Ｄｅｖｉｃｅ-identity-123456  ")).toBe("Device-identity-123456");
    expect(() => canonicalIdentity("device-identity-\u0000123456")).toThrow("INVALID_DEVICE_ID");
  });

  it("builds the product manifest identity consumed by products", async () => {
    const { buildProductManifest } = await import("@/lib/licensing/product-identity");
    expect(buildProductManifest({ product_id: "prod-1", product_version: "1.2.3", install_id: "install-1", device_id: "device-1" })).toEqual({ schema: "bke.manifest.v1", product_id: "prod-1", product_version: "1.2.3", install_id: "install-1", device_id: "device-1" });
  });

  it("validates the exact signed lease envelope and strict payload", async () => {
    const { leaseEnvelopeSchema, leasePayloadSchema, parseLeaseEnvelope } = await import("@/v2/apps/web/licensing/cloud-agent-contract");
    const payload = JSON.stringify({ license_id: "lic-1", lease_id: "l1", generation: 1, server_revision: 1, product_id: "p1", installation_id: "i1", device_id: "d1", version: "1.0.0", issuer: "BKE Digital Solutions", issued_at: "2026-01-01T00:00:00.000Z", not_before: "2026-01-01T00:00:00.000Z", expires_at: "2026-02-01T00:00:00.000Z", key_id: "k1", algorithm: "Ed25519", revoked: false, superseded_by: null });
    const envelope = { payload, signature: "sig", key_id: "k1", algorithm: "Ed25519" };
    expect(parseLeaseEnvelope(envelope)).toEqual(envelope);
    expect(() => leaseEnvelopeSchema.parse({ ...envelope, authorization: { allowed: true } })).toThrow();
    expect(() => leasePayloadSchema.parse({ ...JSON.parse(payload), authorization: true })).toThrow();
  });

  it("enforces the versioned cloud boundary and lifecycle request rules", async () => {
    const { CLOUD_AGENT_PROTOCOL_VERSION, requireCloudAgentVersion, cloudAgentRequestSchema, validateLifecycleRequest, CloudAgentProtocolError } = await import("@/v2/apps/web/licensing/cloud-agent-contract");
    expect(CLOUD_AGENT_PROTOCOL_VERSION).toBe("bke.licensing.v3");
    expect(() => requireCloudAgentVersion(new Request("http://local", { headers: { "x-bke-licensing-version": "bke.licensing.v2" } }))).toThrow("UNSUPPORTED_PROTOCOL_VERSION");
    expect(() => requireCloudAgentVersion(new Request("http://local", { headers: { "x-bke-licensing-version": "bke.licensing.v3" } }))).not.toThrow();
    const request = cloudAgentRequestSchema.parse({ licenseKey: "BKE-" + "A".repeat(40), installationId: "i".repeat(32), deviceId: "d".repeat(16), operationId: "operation-1", productVersion: "1.0.0", action: "TRANSFER", predecessorLeaseId: "lease-1" });
    expect(() => validateLifecycleRequest(request)).not.toThrow();
    expect(() => validateLifecycleRequest({ ...request, predecessorLeaseId: undefined })).toThrowError(CloudAgentProtocolError);
  });

  it("requires direct lease issuance to receive an explicit requested version", () => {
    const source = readFileSync("lib/licensing/commercial-lease.ts", "utf8");
    expect(source).toContain("productVersion: string;");
    expect(source).toContain("requireProductVersion(input.productVersion)");
    expect(source).not.toContain("input.productVersion ?? license.product.versions[0]?.version");
  });

  it("keeps runtime licensing independent from release lifecycle while requiring an active registered version", () => {
    const source = readFileSync("lib/licensing/commercial-lease.ts", "utf8");
    expect(source).toContain("versions: { where: { version: input.productVersion, active: true }");
    expect(source).not.toContain('lifecycle: { in: ["STABLE", "LTS"] }');
    expect(source).toContain('throw new Error("VERSION_NOT_ELIGIBLE")');
    expect(source).toContain("isVersionAccepted(version, license.product.minimumAcceptedVersion, license.product.maximumAcceptedVersion)");
  });

  it("self-verifies newly issued signed leases", async () => {
    const { issueSignedLease, verifySignedLease } = await import("@/lib/licensing-agent");
    const payload = { license_id: "license-self", lease_id: "l-self", generation: 1, server_revision: 1, product_id: "p1", installation_id: "i1", device_id: "d1", version: "1.0.0", issuer: "BKE Digital Solutions", issued_at: "2026-01-01T00:00:00.000Z", not_before: "2026-01-01T00:00:00.000Z", expires_at: "2026-02-01T00:00:00.000Z", key_id: "k1", algorithm: "Ed25519" as const, revoked: false, superseded_by: null };
    const lease = issueSignedLease(payload);
    expect(verifySignedLease(lease)).toBe(true);
    expect(verifySignedLease({ ...lease, payload: lease.payload.replace("l-self", "l-other") })).toBe(false);
  });
});

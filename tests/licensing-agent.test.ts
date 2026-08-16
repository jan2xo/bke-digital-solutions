import { describe, expect, it } from "vitest";

describe("commercial Licensing Agent lease boundary", () => {
  it("issues an Ed25519 lease envelope and rejects tampering", async () => {
    Object.assign(process.env, { APP_URL: "http://localhost:3000", DATABASE_URL: "postgresql://test:test@postgres:5432/test", SESSION_SECRET: "test-session-secret-abcdefghijklmnopqrstuvwxyz-123456", LICENSE_PEPPER: "test-license-pepper-abcdefghijklmnopqrstuvwxyz-123456", CRON_SECRET: "test-cron-secret-abcdefghijklmnopqrstuvwxyz-123456", S3_BUCKET: "test-bucket", EMAIL_FROM: "test@example.com", NODE_ENV: "test" });
    const { issueSignedLease, verifySignedLease } = await import("@/lib/licensing-agent");
    const lease = issueSignedLease({ lease_id: "lease-test", generation: 1, server_revision: 1, product_id: "product-test", installation_id: "installation-test-123456789012345678901234567890", device_id: "device-test-123456", version: "1.0.0", issuer: "BKE Digital Solutions", issued_at: new Date(0).toISOString(), not_before: new Date(0).toISOString(), expires_at: new Date(86400000).toISOString(), key_id: "development-ed25519-v1", algorithm: "Ed25519", revoked: false, superseded_by: null });
    expect(lease.algorithm).toBe("Ed25519");
    expect(verifySignedLease(lease)).toBe(true);
    expect(verifySignedLease({ ...lease, payload: lease.payload.replace("product-test", "tampered") })).toBe(false);
    expect(lease).not.toHaveProperty("authorization");
    expect(lease).not.toHaveProperty("AuthorizationDecision");
  });
});

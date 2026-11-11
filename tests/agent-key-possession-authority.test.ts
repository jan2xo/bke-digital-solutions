import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync("apps/web/agent-sessions/agent-key-proof-authority.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261111130000_agent_lease_key_proof/migration.sql", "utf8",
);
const integration = readFileSync("tests/integration/agent-key-possession-authority.test.ts", "utf8");

describe("DS real Agent key proof authority source safety", () => {
  it("authenticates the Agent session before each key operation", () => {
    expect(service).toContain("authenticateAgentAccessToken(tx, input)");
    for (const owner of ["beginAgentKeyEnrollment", "beginAgentLeaseKeyChallenge",
      "verifyAgentKeyChallenge", "revokeAgentLeaseKey"]) {
      const part = service.slice(service.indexOf("export async function " + owner));
      expect(part.indexOf("await authenticated(tx, input)"))
        .toBeLessThan(part.indexOf("tx.$queryRaw"));
    }
    expect(service).toContain("row.sessionId !== session.sessionId");
    expect(service).toContain("row.accountId !== session.accountId");
    expect(service).toContain("row.userId !== session.userId");
    expect(service).toContain("row.deviceId !== session.deviceId");
  });
  it("persists only public keys with terminal revocation and real session foreign keys", () => {
    expect(migration).toContain('CREATE TABLE "AgentLeaseKeyRegistration"');
    expect(migration).toContain('CREATE TABLE "AgentLeaseKeyChallenge"');
    expect(migration).toContain('FOREIGN KEY ("sessionId") REFERENCES "AgentAccountSession"');
    expect(migration).toContain('FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"');
    expect(migration).toContain('FOREIGN KEY ("userId") REFERENCES "User"');
    expect(migration).toContain('CHECK ("keyProtection" = \'software\')');
    expect(migration).toContain('WHERE "status" = \'ACTIVE\'');
    expect(migration).toContain('WHERE "status" = \'PENDING\'');
    expect(migration).toContain('"AgentLeaseKeyRegistration_revoked_shape_check"');
    expect(migration).not.toContain('"privateKeyPem"');
  });
  it("separates purpose, product/action and unpredictable one-time challenge bytes", () => {
    expect(service).toContain('randomBytes(32).toString("base64url")');
    expect(service).toContain('"bke.agent-key-proof.v1"');
    expect(service).toContain('session.sessionId, session.accountId, session.userId, session.deviceId');
    expect(service).toContain('productId ?? "-", action ?? "-", nonce');
    expect(service).toContain('CHALLENGE_TTL_MS = 30_000');
    expect(migration).toContain('"AgentLeaseKeyChallenge_messageHash_key"');
    expect(migration).toContain('"purpose" IN (\'ENROLL\',\'LEASE\')');
  });
  it("burns a challenge before actual Ed25519 signature verification", () => {
    expect(service).toContain('AND "consumedAt" IS NULL');
    expect(service).toContain('reason: "BAD_SIGNATURE"');
    expect(service).toContain('trustedKey.thumbprint !== row.keyThumbprint');
    expect(service).toContain("verify(null, msg, createPublicKey(trustedKey.pem), signature)");
    expect(service.indexOf('UPDATE "AgentLeaseKeyChallenge" SET "consumedAt"'))
      .toBeLessThan(service.indexOf("verify(null, msg, createPublicKey"));
    expect(service).toContain('proofState: "VERIFIED" as const');
    expect(service).toContain("const trustBrand = Symbol");
    expect(service).toContain("proof[trustBrand] !== true");
  });
  it("records enrollment and terminal revocation separately", () => {
    expect(service).toContain('row.purpose === "ENROLL" && row.status !== "PENDING"');
    expect(service).toContain('row.purpose === "LEASE" && row.status !== "ACTIVE"');
    expect(service).toContain("AGENT_LEASE_KEY_ENROLLED");
    expect(service).toContain("AGENT_LEASE_KEY_REVOKED");
    expect(service).toContain("UPDATE \"AgentLeaseKeyRegistration\" SET \"status\" = 'REVOKED'");
  });
  it("cannot bypass the L2 decision or introduce a signer through this proof", () => {
    expect(service).toContain("prepareAccountProductLeaseClaims(eligibility, proof.evidence, now)");
    expect(service).toContain("proof.productId !== eligibility.productId");
    expect(service).toContain("proof.action !== eligibility.action");
    expect(service).not.toContain("issueAccountProductLeaseJws");
    expect(service).not.toContain("createPrivateKey");
    expect(service).not.toContain("process.env");
    expect(service).not.toContain("PayMongo");
    expect(service).not.toContain("Resend");
    expect(service).not.toContain("V3_");
  });
  it("requires real disposable PostgreSQL and actual Ed25519 signing", () => {
    expect(integration).toContain("seedSession(userId, accountId)");
    expect(integration).toContain("hashAgentAccessToken(token, pepper)");
    expect(integration).toContain('isolationLevel: "Serializable"');
    expect(integration).toContain('generateKeyPairSync("ed25519")');
    expect(integration).toContain("sign(null, Buffer.from(challenge.messageBase64url");
    expect(integration).toContain("foreignToken");
    expect(integration).toContain('reason: "BAD_SIGNATURE"');
    expect(integration).toContain('reason: "INVALID_CHALLENGE"');
    expect(integration).toContain("prepareLeaseClaimsWithVerifiedKey");
    expect(integration).toContain("revokeAgentLeaseKey");
  });
});

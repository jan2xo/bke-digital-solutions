import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adapter = readFileSync("apps/web/agent-sessions/agent-key-http.ts", "utf8");
const routes = ["enroll", "verify", "revoke", "status"].map((name) =>
  readFileSync("app/api/agent-sessions/keys/" + name + "/route.ts", "utf8"));
const authority = readFileSync("apps/web/agent-sessions/agent-key-proof-authority.ts", "utf8");
const config = readFileSync("platform/host/config/environment.ts", "utf8");

describe("Agent machine-key HTTP enrollment security contract", () => {
  it("has three POST-only endpoints through one audit boundary", () => {
    ["enroll", "verify", "revoke", "status"].forEach((name, index) => {
      expect(routes[index]).toContain('agentKeyHttp(request, "' + name + '")');
      expect(routes[index]).not.toContain("privateKey");
    });
  });
  it("does not activate key HTTP under a general Agent-session switch or production deployment", () => {
    expect(config).toContain("AGENT_KEY_HTTP_ENABLED: bool.default(false)");
    expect(adapter).toContain("!runtime.AGENT_ACCOUNT_SESSION_ENABLED");
    expect(adapter).toContain("!runtime.AGENT_KEY_HTTP_ENABLED");
    expect(adapter).toContain('runtime.DEPLOYMENT_ENV === "production"');
    const gate = adapter.indexOf("!runtime.AGENT_KEY_HTTP_ENABLED");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(adapter.indexOf("rejectBrowserOriginForAgent(request);"));
    expect(gate).toBeLessThan(adapter.indexOf("nativeAgentBearerToken(request)"));
    expect(gate).toBeLessThan(adapter.indexOf("db.$transaction("));
    expect(config).not.toContain("V3_AGENT_KEY_HTTP_ENABLED");
  });
  it("checks Agent session protocol and Bearer before any key transaction", () => {
    expect(adapter).toContain("nativeAgentBearerToken(request)");
    expect(adapter).toContain("rejectBrowserOriginForAgent(request)");
    expect(adapter).toContain("requireAgentAccountSessionProtocol(request)");
    expect(adapter).toContain("AGENT_ACCOUNT_SESSION_ENABLED");
    expect(adapter).toContain('response({ error: "INVALID_TOKEN" }, 401)');
    expect(authority).toContain("authenticateAgentAccessToken(tx, input)");
  });
  it("bounds input size and fail-closes IP plus bearer denial", () => {
    expect(adapter).toContain('":ip:" + ip');
    expect(adapter).toContain('":bearer:" + tokenHash');
    expect(adapter).toContain('createHash("sha256")');
    expect(adapter).toContain("rateLimit(");
    expect(adapter).toContain("size > 8192");
    expect(adapter).toContain("reader.cancel()");
    expect(adapter).toContain('new TextDecoder("utf-8", { fatal: true })');
    expect(adapter).toContain('}).strict()');
    expect(adapter).toContain("RATE_LIMITER_UNAVAILABLE");
  });
  it("uses existing authenticated cryptographic DB authority and serializable transactions", () => {
    for (const operation of ["beginAgentKeyEnrollment", "verifyAgentKeyChallenge", "revokeAgentLeaseKey"]) {
      expect(adapter).toContain(operation + "(tx,");
    }
    expect(adapter.match(/isolationLevel: "Serializable"/g)?.length).toBe(4);
    expect(authority).toContain('UPDATE "AgentLeaseKeyChallenge" SET "consumedAt"');
    expect(authority).toContain("verifyAgentSignature(trustedKey.algorithm, trustedKey.pem, msg, signature)");
    expect(authority).toContain('trustedKey.algorithm !== row.keyAlgorithm');
    expect(authority).toContain('dsaEncoding: "ieee-p1363"');
    expect(adapter).not.toContain("key_protection: parsed.data");
    expect(adapter).not.toContain("key_algorithm: parsed.data");
  });
  it("forbids remote LEASE proof, untrusted machine protection and JWS issuance", () => {
    expect(adapter).toContain('rows[0]?.purpose !== "ENROLL"');
    expect(adapter).not.toContain("prepareLeaseClaimsWithVerifiedKey");
    expect(adapter).not.toContain("issueAccountProductLeaseJws");
    expect(adapter).not.toContain("createPrivateKey");
    expect(adapter).not.toContain("TPM-backed");
  });
  it("prevents response caching and returns uniform failed-proof error", () => {
    expect(adapter).toContain('"cache-control": "no-store"');
    expect(adapter).toContain('response({ error: "INVALID_PROOF" }, 403)');
    expect(adapter).toContain('response({ error: "RATE_LIMITED" }, 429)');
  });
});

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const suite = readFileSync("tests/integration/agent-key-cross-repo-live-http.test.ts", "utf8");
describe("immutable cross-repo Agent to actual DS HTTPS route certification", () => {
  it("pins immutable public Agent source, not HEAD/main or moving PR", () => {
    expect(suite).toContain('AGENT_EXACT_SHA = "b4ca67fc4624693afa324ac4f4fa3a78bb76fab0"');
    expect(suite).toContain('git(["-C", agentRoot, "rev-parse", "HEAD"])');
    expect(suite).toContain("expect(fetched).toBe(AGENT_EXACT_SHA)");
  });
  it("tests actual POST routes with HTTPS and disposable PostgreSQL via a separate dotnet process", () => {
    for (const x of [
      "@/app/api/agent-sessions/keys/enroll/route",
      "@/app/api/agent-sessions/keys/verify/route",
      "@/app/api/agent-sessions/keys/status/route",
      "@/app/api/agent-sessions/keys/revoke/route",
      "createServer({",
      'listen(0, "127.0.0.1"',
      "PrismaPg",
      "AgentDeviceAuthorization",
      "AgentAccountSession",
      'execAsync("dotnet"',
      "--live-disposable-ds",
      "BKE_CROSS_REPO_CERT_SHA256",
      "BKE_CROSS_REPO_BEARER",
    ]) expect(suite).toContain(x);
    expect(suite).toContain('["EdDSA", "ES256"] as const');
    expect(suite).toContain("BKE_CROSS_REPO_SIGNER_ALGORITHM");
    // Real DS route must carry the database-owned algorithm into authenticated status.
    const adapter = readFileSync("apps/web/agent-sessions/agent-key-http.ts", "utf8");
    expect(adapter).toContain("key_algorithm: result.keyAlgorithm");
    expect(adapter).not.toContain("key_algorithm: parsed.data");
    expect(suite).toContain("7 assertions; algorithm=");
    expect(suite).not.toContain("vitest.skip");
    expect(suite).not.toContain("it.skip");
    expect(suite).not.toContain("describe.skip");
  });
  it("uses disposable signing material and no production/release/provider mutation", () => {
    expect(suite).toContain("mkdtempSync");
    expect(suite).toContain("rmSync(temp");
    expect(suite).toContain("AGENT_ACCOUNT_SESSION_ENABLED");
    expect(suite).toContain("AGENT_KEY_HTTP_ENABLED");
    expect(suite).toContain('process.env.DEPLOYMENT_ENV = "test"');
    expect(suite).toContain("delete process.env.AGENT_KEY_HTTP_ENABLED");
    expect(suite).not.toContain("PAYMONGO_SECRET_KEY");
    expect(suite).not.toContain("RESEND_API_KEY");
    expect(suite).not.toContain("PRODUCTION_DATABASE_URL");
  });
});

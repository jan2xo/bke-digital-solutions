import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const suite = readFileSync("tests/integration/agent-key-cross-repo-live-http.test.ts", "utf8");
describe("immutable cross-repo Agent to actual DS HTTPS route certification", () => {
  it("pins immutable public Agent source, not HEAD/main or moving PR", () => {
    expect(suite).toContain('AGENT_EXACT_SHA = "bcf2616bd7ead980c905a4acf130df4eca5df385"');
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
    expect(suite).not.toContain("vitest.skip");
    expect(suite).not.toContain("it.skip");
    expect(suite).not.toContain("describe.skip");
  });
  it("uses disposable signing material and no production/release/provider mutation", () => {
    expect(suite).toContain("mkdtempSync");
    expect(suite).toContain("rmSync(temp");
    expect(suite).toContain("AGENT_ACCOUNT_SESSION_ENABLED");
    expect(suite).not.toContain("PAYMONGO_SECRET_KEY");
    expect(suite).not.toContain("RESEND_API_KEY");
    expect(suite).not.toContain("PRODUCTION_DATABASE_URL");
  });
});

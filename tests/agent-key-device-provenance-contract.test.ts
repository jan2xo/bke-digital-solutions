import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const authority = readFileSync("apps/web/agent-sessions/agent-key-proof-authority.ts", "utf8");
const adapter = readFileSync("apps/web/agent-sessions/agent-key-http.ts", "utf8");
const agentCross = readFileSync("tests/integration/agent-key-cross-repo-live-http.test.ts", "utf8");
const pg = readFileSync("tests/integration/agent-key-possession-authority.test.ts", "utf8");
describe("machine-key first-enrollment device authorization provenance", () => {
  it("requires original high-entropy device code separate from authenticated bearer", () => {
    expect(adapter).toContain("device_code: z.string().regex");
    expect(adapter).toContain("deviceCode: parsed.data.device_code");
    expect(authority).toContain("authenticateAgentAccessToken(tx, input)");
    expect(authority).toContain("hashAgentDeviceCode(input.deviceCode, input.pepper)");
    expect(authority).toContain('a."deviceCodeHash" =');
    expect(authority).toContain('a."sessionId" = s."id"');
    expect(authority).toContain('a."approvedByUserId" =');
    expect(authority).toContain('a."approvedAccountId" =');
    expect(authority).toContain('a."status" = \'CONSUMED\'');
    expect(authority).toContain("DEVICE_PROOF_REQUIRED");
  });
  it("protects native handoff and one-session-one-key terminal state", () => {
    expect(authority).toContain("'DEVICE_CODE','NATIVE_HANDOFF'");
    expect(authority).toContain("previous.status !== \"PENDING\"");
    expect(authority).toContain("previous.keyThumbprint !== pub.thumbprint");
    expect(authority).toContain("previous.keyAlgorithm !== pub.algorithm");
    expect(authority).toContain('WHERE "sessionId" =');
    expect(pg).toContain('native handoff requires its independently issued device code');
    expect(pg).toContain('rejects bearer-only theft');
    expect(pg).toContain('PENDING_RETRY_FAILED');
  });
  it("pins live HTTPS test to Agent's exact protected secret consumer SHA", () => {
    expect(agentCross).toContain('8135b6673bd6800bd0d30e29b623439a43bac6d3');
    expect(agentCross).toContain("hashAgentDeviceCode(deviceCode, pepper)");
    expect(agentCross).toContain("BKE_CROSS_REPO_DEVICE_CODE");
    expect(agentCross).toContain('expect(result.stdout).toContain("8 assertions; algorithm=" + algorithm)');
  });
  it("does not add secret-bearing response or key issue privilege", () => {
    const body = adapter.slice(adapter.indexOf('if (operation === "enroll")'),
      adapter.indexOf('if (operation === "verify")'));
    expect(body).not.toContain("device_code:");
    expect(body).not.toContain("private_key");
    expect(body).not.toContain("issueAccountProductLeaseJws");
  });
});

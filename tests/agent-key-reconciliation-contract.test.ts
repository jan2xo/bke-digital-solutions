import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const authority = readFileSync("apps/web/agent-sessions/agent-key-reconciliation.ts", "utf8");
const adapter = readFileSync("apps/web/agent-sessions/agent-key-http.ts", "utf8");
const route = readFileSync("app/api/agent-sessions/keys/status/route.ts", "utf8");
const integrated = readFileSync("tests/integration/agent-key-possession-authority.test.ts", "utf8");
describe("DS Agent key status reconciliation security ownership", () => {
  it("reads only authenticated exact session/account/user/device without issuance", () => {
    expect(authority).toContain("authenticateAgentAccessToken(tx, input)");
    expect(authority).toContain("key.sessionId !== session.sessionId");
    expect(authority).toContain("key.accountId !== session.accountId");
    expect(authority).toContain("key.userId !== session.userId");
    expect(authority).toContain("key.deviceId !== session.deviceId");
    expect(authority).toContain("if (rows.length > 1)");
    expect(authority).not.toContain("INSERT INTO");
    expect(authority).not.toContain("issueAccountProductLeaseJws");
  });
  it("requires bearer-scoped query, never arbitrary account lookup", () => {
    expect(authority).toContain("input.registrationId");
    expect(authority).toContain("session.sessionId");
    expect(integrated).toContain("registrationState(foreignToken, registrationId)");
    expect(integrated).toContain('registrationState("invalid-token", registrationId)');
  });
  it("preserves bounded rate-limited Agent-only transaction protocol", () => {
    expect(route).toContain('agentKeyHttp(request, "status")');
    expect(adapter).toContain("readAgentKeyRegistrationState(tx,");
    expect(adapter).toContain('isolationLevel: "Serializable"');
    expect(adapter).toContain('rejectBrowserOriginForAgent(request)');
    expect(adapter).toContain('requireAgentAccountSessionProtocol(request)');
    expect(adapter).toContain('operation === "status"');
    expect(adapter).toContain('cache-control');
  });
});

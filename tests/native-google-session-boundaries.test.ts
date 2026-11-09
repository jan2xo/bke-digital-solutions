import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("native Google-session authorization boundaries", () => {
  it("preserves account grant revocation, expiry and access authority without retired credential consumers", () => {
    const authority = readFileSync("apps/web/agent-sessions/device-authorization.ts", "utf8");
    expect(authority).toContain("revokeAgentSessionFamily");
    expect(authority).toContain("session.revokedAt");
    expect(authority).toContain("session.accessExpiresAt <= now");
    expect(authority).toContain("requireAgentDeviceAccountAccessInTransaction");
    expect(authority).not.toContain("passwordCredential");
    expect(authority).not.toContain("administratorMfaMethod");
  });
});

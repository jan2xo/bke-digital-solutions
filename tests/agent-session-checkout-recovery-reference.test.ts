import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const helper = () =>
  readFileSync("apps/web/agent-sessions/store-checkout-recovery.ts", "utf8");

describe("Agent Store checkout recovery identity", () => {
  it("uses an opaque stable device-bound source for new mutations", () => {
    const source = helper();

    expect(source).toContain('createHash("sha256")');
    expect(source).toContain("agent-checkout-device:");
    expect(source).toContain("durableRecoveryKey(");
    expect(source).toContain("session.deviceId");
    expect(source).toContain("session.userId");
    expect(source).toContain("session.accountId");
    expect(source).not.toContain("accessToken");
    expect(source).not.toContain("refreshToken");
  });

  it("limits legacy recovery to historical sessions for the same user account and device", () => {
    const source = helper();

    expect(source).toContain('"deviceId" = ${session.deviceId}');
    expect(source).toContain('"userId" = ${session.userId}');
    expect(source).toContain('"accountId" = ${session.accountId}');
    expect(source).toContain('ORDER BY "createdAt" DESC');
    expect(source).toContain("LEGACY_SESSION_CANDIDATE_LIMIT = 64");
    expect(source).toContain('legacyAgentCheckoutSourceReference(item.id, correlationId)');
  });

  it("preserves current-session legacy recovery while preferring the durable device source", () => {
    const source = helper();
    const durableIndex = source.indexOf(
      "durableAgentCheckoutSourceReference(session, correlationId)",
    );
    const currentLegacyIndex = source.indexOf(
      "legacyAgentCheckoutSourceReference(session.sessionId, correlationId)",
    );

    expect(durableIndex).toBeGreaterThanOrEqual(0);
    expect(currentLegacyIndex).toBeGreaterThan(durableIndex);
    expect(source).toContain("new Set(candidates)");
  });

  it("does not broaden recovery to unrelated devices or accounts", () => {
    const source = helper();

    expect(source).not.toContain('WHERE "accountId" = ${session.accountId}\n     ORDER BY');
    expect(source).not.toContain("recipient");
    expect(source).not.toContain("payment");
    expect(source).not.toContain("provider");
  });
});

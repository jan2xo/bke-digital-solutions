import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("native BKE password reset request", () => {
  it("exposes password-reset request through the native protocol without browser-origin spoofing", () => {
    const route = read("app/api/agent-sessions/native/password-reset/request/route.ts");

    expect(route).toContain("rejectBrowserOriginForAgent(request)");
    expect(route).toContain("requireAgentAccountSessionProtocol(request)");
    expect(route).toContain("IDENTITY_PASSWORD_RESET_REQUEST_CAPABILITY_ID");
    expect(route).toContain("passwordReset.request");
    expect(route).toContain("sendPasswordReset");
    expect(route).toContain('status: "accepted"');
    expect(route).not.toContain("assertSameOrigin");
    expect(route).not.toContain("createSession");
  });

  it("preserves account-enumeration resistance and never reflects reset material", () => {
    const route = read("app/api/agent-sessions/native/password-reset/request/route.ts");

    expect(route).toContain("result.delivery");
    expect(route).toContain(".catch(() => undefined)");
    expect(route).not.toContain("email_sent");
    expect(route).not.toContain("recipient_email");
    expect(route).not.toContain("token:");
    expect(route).not.toContain("result.delivery.token,");
  });

  it("invalidates Agent sessions against the latest password credential epoch", () => {
    const authority = read("apps/web/agent-sessions/device-authorization.ts");

    expect(authority).toContain("createdAt: Date");
    expect(authority).toContain("passwordCredential.findUnique");
    expect(authority).toContain("credential.changedAt > session.createdAt");
    expect(
      authority.match(/credential\.changedAt > session\.createdAt/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(authority).toContain("await revokeAgentSessionFamily(tx, session.id, now)");
  });

  it("keeps existing browser reset completion as the credential authority", () => {
    const route = read("app/api/auth/password-reset/consume/route.ts");

    expect(route).toContain("IDENTITY_PASSWORD_RESET_COMPLETION_CAPABILITY_ID");
    expect(route).toContain("passwordReset.complete");
    expect(route).toContain("assertSameOrigin(request)");
  });
});

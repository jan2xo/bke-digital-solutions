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
    expect(route).toContain("after(async () =>");
    expect(route).toContain('status: "accepted"');
    expect(route).not.toContain("assertSameOrigin");
    expect(route).not.toContain("createSession");
  });

  it("preserves account-enumeration resistance and never reflects reset material", () => {
    const route = read("app/api/agent-sessions/native/password-reset/request/route.ts");

    expect(route).toContain("result.delivery");
    expect(route).toContain("const delivery =");
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
      authority.match(/agentSessionPredatesPasswordCredential\(tx, session\)/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(authority).toContain("await revokeAgentSessionFamily(tx, session.id, now)");
  });

  it("exposes password-reset completion through the native protocol without creating a session", () => {
    const route = read("app/api/agent-sessions/native/password-reset/complete/route.ts");

    expect(route).toContain("rejectBrowserOriginForAgent(request)");
    expect(route).toContain("requireAgentAccountSessionProtocol(request)");
    expect(route).toContain("IDENTITY_PASSWORD_RESET_COMPLETION_CAPABILITY_ID");
    expect(route).toContain("passwordReset.complete(input)");
    expect(route).toContain("passwordSchema");
    expect(route).toContain('status: "completed"');
    expect(route).not.toContain("assertSameOrigin(request)");
    expect(route).not.toContain("createSession");
    expect(route).not.toContain("handoff");
  });

  it("keeps native reset secrets transient and narrows the success response", () => {
    const route = read("app/api/agent-sessions/native/password-reset/complete/route.ts");

    expect(route).toContain("token: z.string().min(20)");
    expect(route).toContain("password: passwordSchema");
    expect(route).toContain("input.token !== input.token.trim()");
    expect(route).toContain("passwordReset.complete(input)");
    expect(route).toContain('return response({ status: "completed" })');
    expect(route).not.toContain("result.token");
    expect(route).not.toContain("result.password");
    expect(route).not.toContain("recipient_email");
    expect(route).not.toContain("account_id");
    expect(route).not.toContain("session_id");
  });

  it("keeps browser and native reset completion on the same Identity authority", () => {
    const browser = read("app/api/auth/password-reset/consume/route.ts");
    const native = read("app/api/agent-sessions/native/password-reset/complete/route.ts");

    for (const route of [browser, native]) {
      expect(route).toContain("IDENTITY_PASSWORD_RESET_COMPLETION_CAPABILITY_ID");
      expect(route).toContain("passwordReset.complete(input)");
    }

    expect(browser).toContain("assertSameOrigin(request)");
    expect(native).toContain("rejectBrowserOriginForAgent(request)");
    expect(native).not.toContain("assertSameOrigin(request)");
  });
});

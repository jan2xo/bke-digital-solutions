import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routePath = "app/api/agent-sessions/account/password-change/route.ts";
const sessionAuthorityPath = "apps/web/agent-sessions/device-authorization.ts";

const read = (path: string) => readFileSync(path, "utf8");

describe("native BKE account password change", () => {
  it("accepts only authenticated password-change intent through the Agent-session boundary", () => {
    const route = read(routePath);

    expect(route).toContain("rejectBrowserOriginForAgent(request)");
    expect(route).toContain("requireAgentAccountSessionProtocol(request)");
    expect(route).toContain("authenticateAgentAccessToken");
    expect(route).toContain('request.headers.get("authorization")');
    expect(route).toContain("current_password");
    expect(route).toContain("new_password");
    expect(route).not.toContain("user_id:");
    expect(route).not.toContain("account_id:");
    expect(route).not.toContain("email:");
  });

  it("keeps credential validation and hashing in Digital Solutions", () => {
    const route = read(routePath);

    expect(route).toContain("verifyPassword");
    expect(route).toContain("hashPassword");
    expect(route).toContain("tx.passwordCredential.findUnique");
    expect(route).toContain("tx.passwordCredential.update");
    expect(route).not.toContain("password_hash");
    expect(route).not.toContain("console.log");
  });

  it("revokes browser and every durable Agent account session after a successful change", () => {
    const route = read(routePath);
    const sessionAuthority = read(sessionAuthorityPath);

    expect(route).toContain("tx.session.updateMany");
    expect(route).toContain('revocationReason: "PASSWORD_CHANGED"');
    expect(route).toContain("revokeAgentAccountSessionsForUser");
    expect(sessionAuthority).toContain("export async function revokeAgentAccountSessionsForUser");
    expect(sessionAuthority).toContain('UPDATE "AgentAccountSession"');
    expect(sessionAuthority).toContain('UPDATE "AgentAccountRefreshToken"');
    expect(sessionAuthority).toContain('UPDATE "AgentDeviceAuthorization"');
    expect(sessionAuthority).toContain('"tokenBundleCiphertext" = NULL');
  });

  it("forces clean native reauthentication and returns no replacement secret", () => {
    const route = read(routePath);

    expect(route).toContain('status: "changed"');
    expect(route).toContain("reauthentication_required: true");
    expect(route).not.toContain("access_token:");
    expect(route).not.toContain("refresh_token:");
    expect(route).not.toContain("handoff_code:");
  });

  it("keeps validation failures inside the Agent-session protocol envelope", () => {
    const route = read(routePath);

    expect(route).toContain("error instanceof z.ZodError");
    expect(route).toContain('return json({ error: "INVALID_INPUT" }, 400)');
  });

  it("records security and audit evidence without password material", () => {
    const route = read(routePath);

    expect(route).toContain("tx.securityEvent.create");
    expect(route).toContain('type: "PASSWORD_CHANGED"');
    expect(route).toContain('outcome: "SUCCESS"');
    expect(route).toContain('severity: "HIGH"');
    expect(route).toContain('action: "PASSWORD_CHANGED"');
    expect(route).toContain('channel: "BKE_AGENT_SESSION"');
    expect(route).not.toContain("securityEvent(");

    const evidence = route.slice(
      route.indexOf("await tx.securityEvent.create"),
      route.indexOf('status: "changed" as const'),
    );
    expect(evidence).not.toContain("input.current_password");
    expect(evidence).not.toContain("input.new_password");
  });
});

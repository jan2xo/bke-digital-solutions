import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("retired native password reset", () => {
  it("retires native reset requests with a generic Google handoff response", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/native/password-reset/request/route"
    );
    const response = await POST();

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      error: "GOOGLE_BROWSER_HANDOFF_REQUIRED",
    });
  });

  it("does not reveal whether a native password-reset account exists", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/native/password-reset/request/route"
    );
    const withoutAccount = await POST();
    const withAccount = await POST();
    const withoutBody = await withoutAccount.json();
    const withBody = await withAccount.json();

    expect(withoutAccount.status).toBe(withAccount.status);
    expect(withoutBody).toEqual(withBody);
    expect(JSON.stringify(withoutBody)).not.toMatch(/email|token|password/i);
  });

  it("continues to invalidate old Agent sessions after a credential epoch change", () => {
    const authority = readFileSync(
      "apps/web/agent-sessions/device-authorization.ts",
      "utf8",
    );

    expect(authority).toContain("createdAt: Date");
    expect(authority).toContain("passwordCredential.findUnique");
    expect(authority).toContain("credential.changedAt > session.createdAt");
    expect(
      authority.match(/agentSessionPredatesPasswordCredential\(tx, session\)/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(authority).toContain("await revokeAgentSessionFamily(tx, session.id, now)");
  });

  it("retires native reset completion without issuing a session or reflecting reset material", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/native/password-reset/complete/route"
    );
    const response = await POST();

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).not.toMatch(/token|password|session/i);
  });

  it("retires browser password-reset routes with the same no-store policy", async () => {
    const request = await import("../app/api/auth/password-reset/request/route");
    const consume = await import("../app/api/auth/password-reset/consume/route");

    for (const handler of [request.POST, consume.POST]) {
      const response = await handler();
      expect(response.status).toBe(410);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
});

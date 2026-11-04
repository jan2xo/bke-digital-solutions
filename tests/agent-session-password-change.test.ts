import { describe, expect, it } from "vitest";

describe("retired native password change", () => {
  it("requires browser security instead of accepting an Agent password mutation", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/password-change/route"
    );
    const response = await POST();

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      error: "BROWSER_SECURITY_REQUIRED",
    });
  });

  it("has no password processing or replacement-secret response path", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/password-change/route"
    );
    const response = await POST();
    const body = await response.text();

    expect(body).not.toMatch(/password|access_token|refresh_token|handoff_code/i);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

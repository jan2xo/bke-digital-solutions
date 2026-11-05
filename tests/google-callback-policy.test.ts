import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  complete: vi.fn(), authenticate: vi.fn(), current: vi.fn(), issue: vi.fn(), fresh: vi.fn(),
  register: vi.fn(), update: vi.fn(), legal: vi.fn(), event: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "encrypted-test-context" }) }) }));
vi.mock("../apps/web/config/environment", () => ({ getWebHostEnvironment: () => ({ appUrl: "https://staging.example.test" }) }));
vi.mock("../apps/web/auth/google-oidc", () => ({ completeGoogleAuthorization: mocks.complete, GOOGLE_LOGIN_CONTEXT_COOKIE: "bke_google_login" }));
vi.mock("../apps/web/auth/runtime", () => ({ getIdentityWebApplication: async () => ({ get: () => ({ authenticate: mocks.authenticate }) }) }));
vi.mock("../apps/web/auth/session", () => ({ currentIdentitySession: mocks.current, issueGoogleIdentitySession: mocks.issue, recordGoogleSessionFreshness: mocks.fresh }));
vi.mock("../apps/web/auth/google-registration", () => ({ registerGoogleCustomer: mocks.register }));
vi.mock("../apps/web/legal/service", () => ({ pendingReacceptance: mocks.legal }));
vi.mock("../apps/web/security/events", () => ({ securityEvent: mocks.event }));
vi.mock("../platform/host/db", () => ({ db: {
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ user: { update: mocks.update }, auditLog: { create: vi.fn() } }),
} }));
import { GET } from "../app/api/auth/google/callback/route";
let verified: {
  context: { flow: string; returnTo: string; legalVersionIds: string[]; sessionId?: string; userId?: string; subject?: string };
  identity: { subject: string; email: string; emailVerified: boolean; name: string; hostedDomain: string | null; authenticatedAt: Date | null };
};
beforeEach(() => {
  vi.clearAllMocks();
  verified = {
    context: { flow: "login", returnTo: "/dashboard", legalVersionIds: [] },
    identity: { subject: "google-subject", email: "customer@gmail.com", emailVerified: true, name: "Customer", hostedDomain: null, authenticatedAt: null },
  };
  mocks.complete.mockImplementation(async () => verified);
  mocks.authenticate.mockResolvedValue({ status: "PRIMARY_AUTHENTICATED", route: "MFA_ENROLLMENT", principal: { id: "user-a", role: "CUSTOMER" } });
  mocks.current.mockResolvedValue({ session: { id: "session-a" }, principal: { id: "user-a" } });
  mocks.issue.mockResolvedValue({ id: "issued-session" });
  mocks.legal.mockResolvedValue([]);
  mocks.fresh.mockResolvedValue(undefined);
});
const callback = () => GET(new Request("https://staging.example.test/api/auth/google/callback?code=test"));
describe("Google callback consumer policy", () => {
  it("routes a returning Google user directly to the dashboard without BKE factors", async () => {
    const response = await callback();
    expect(response.headers.get("location")).toBe("https://staging.example.test/dashboard");
    expect(mocks.issue).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a", subject: "google-subject", authenticatedAt: null }));
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it("creates a Google customer then requires any pending legal acceptance", async () => {
    verified.context.flow = "register";
    mocks.authenticate.mockResolvedValueOnce({ status: "INVALID_CREDENTIALS" });
    mocks.legal.mockResolvedValue([{ id: "terms-current" }]);
    const response = await callback();
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ subject: "google-subject", emailVerified: true }));
    expect(response.headers.get("location")).toContain("/legal/accept?");
    expect(response.headers.get("location")).not.toContain("verify-email");
  });
  it("uses the bound administrator role without creating an MFA challenge or granting a new role", async () => {
    mocks.authenticate.mockResolvedValue({ status: "PRIMARY_AUTHENTICATED", route: "MFA_CHALLENGE", principal: { id: "user-a", role: "ADMIN" } });
    expect((await callback()).headers.get("location")).toBe("https://staging.example.test/dashboard");
    expect(mocks.update.mock.calls[0][0].data).toEqual({ email: "customer@gmail.com", emailVerified: expect.any(Date) });
    expect(mocks.event).toHaveBeenCalledWith("ADMIN_LOGIN_SUCCEEDED", expect.any(Request), "user-a", undefined, expect.objectContaining({ authenticationMethod: "GOOGLE_OIDC" }));
  });
  it("rejects non-authoritative Google contact addresses without registration or session issuance", async () => {
    verified.identity.email = "customer@external.test";
    expect((await callback()).headers.get("location")).toContain("CONTACT_EMAIL_NOT_AUTHORITATIVE");
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it("does not provision or email-link an unknown subject during login", async () => {
    mocks.authenticate.mockResolvedValue({ status: "INVALID_CREDENTIALS" });
    await callback();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it.each([
    ["different session", { session: { id: "session-b" }, principal: { id: "user-a" } }],
    ["different principal", { session: { id: "session-a" }, principal: { id: "user-b" } }],
    ["revoked session", null],
  ])("rejects a reauthentication callback with %s", async (_name, current) => {
    verified.context = { flow: "reauthenticate", sessionId: "session-a", userId: "user-a", subject: "google-subject", returnTo: "/dashboard", legalVersionIds: [] };
    mocks.current.mockResolvedValue(current);
    expect((await callback()).headers.get("location")).toContain("GOOGLE_FRESH_AUTH_REQUIRED");
    expect(mocks.fresh).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("binds a successful Google freshness proof to the active session without issuing a replacement session", async () => {
    verified.context = { flow: "reauthenticate", sessionId: "session-a", userId: "user-a", subject: "google-subject", returnTo: "/dashboard", legalVersionIds: [] };
    verified.identity.authenticatedAt = new Date(Date.now() - 60_000);
    expect((await callback()).headers.get("location")).toBe("https://staging.example.test/dashboard");
    expect(mocks.fresh).toHaveBeenCalledWith({ sessionId: "session-a", userId: "user-a", subject: "google-subject", authenticatedAt: verified.identity.authenticatedAt });
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("does not replace Google proof with the time of a new callback", async () => {
    verified.context = { flow: "reauthenticate", sessionId: "session-a", userId: "user-a", subject: "google-subject", returnTo: "/dashboard", legalVersionIds: [] };
    mocks.fresh.mockRejectedValue(new Error("RECENT_AUTH_REQUIRED"));
    expect((await callback()).headers.get("location")).toContain("GOOGLE_FRESH_AUTH_REQUIRED");
    expect(mocks.issue).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  verify: vi.fn(),
  user: vi.fn(),
  securityEvent: vi.fn(),
  pendingReacceptance: vi.fn(),
}));

vi.mock("@/apps/web/auth/session", () => ({ createSession: mocks.createSession }));
vi.mock("@/apps/web/auth/mfa-challenge", () => ({
  IDENTITY_MFA_CHALLENGE_COOKIE: "bke_mfa_challenge",
  verifyIdentityLoginMfaChallenge: mocks.verify,
}));
vi.mock("@/apps/web/http/request", () => ({
  assertSameOrigin: vi.fn(),
  clientIp: () => "127.0.0.1",
}));
vi.mock("@/apps/web/http/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/apps/web/security/events", () => ({ securityEvent: mocks.securityEvent }));
vi.mock("@/apps/web/legal/service", () => ({ pendingReacceptance: mocks.pendingReacceptance }));
vi.mock("@/platform/host/db", () => ({ db: { user: { findUnique: mocks.user } } }));

import { POST } from "../app/api/auth/mfa/challenge/route";

describe("Google-only login MFA receiving route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({
      userId: "user-1",
      recoveryUsed: false,
      authenticationMethod: "GOOGLE_OIDC_EMAIL_OTP",
    });
    mocks.user.mockResolvedValue({
      role: "CUSTOMER",
      lifecycleState: "ACTIVE",
      suspendedAt: null,
    });
    mocks.createSession.mockResolvedValue({ id: "session-1" });
    mocks.securityEvent.mockResolvedValue(undefined);
    mocks.pendingReacceptance.mockResolvedValue([]);
  });

  it.each(["PASSWORD_EMAIL_OTP", "PASSWORD_RECOVERY"])(
    "consumes but never upgrades a legacy %s login challenge into a Google-only session",
    async (authenticationMethod) => {
      mocks.verify.mockResolvedValue({
        userId: "user-1",
        recoveryUsed: authenticationMethod === "PASSWORD_RECOVERY",
        authenticationMethod,
      });

      const response = await POST(new Request("https://jl-bke.com/api/auth/mfa/challenge", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://jl-bke.com" },
        body: JSON.stringify({ code: "123456" }),
      }));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "GOOGLE_SIGN_IN_REQUIRED" });
      expect(mocks.createSession).not.toHaveBeenCalled();
    },
  );

  it("issues a session only for an active principal after a Google-bound app factor", async () => {
    const response = await POST(new Request("https://jl-bke.com/api/auth/mfa/challenge", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://jl-bke.com" },
      body: JSON.stringify({ code: "123456", returnTo: "/device?code=BKE-ABCD-EFGH" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledWith("user-1", expect.any(Request), {
      mfaVerified: true,
      recent: true,
      authenticationMethod: "GOOGLE_OIDC_EMAIL_OTP",
    });
  });

  it("does not issue a Google session for an inactive principal", async () => {
    mocks.user.mockResolvedValue({
      role: "ADMIN",
      lifecycleState: "SUSPENDED",
      suspendedAt: null,
    });

    const response = await POST(new Request("https://jl-bke.com/api/auth/mfa/challenge", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://jl-bke.com" },
      body: JSON.stringify({ code: "123456" }),
    }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});

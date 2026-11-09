import { afterEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_GOOGLE_AUTHENTICATION_CAPABILITY_ID } from "@bke/identity/contracts/google-authentication.contract";
import { getIdentityWebApplication } from "../apps/web/auth/runtime";
const globalRuntime = globalThis as unknown as { bkeGoogleIdentityApplication?: unknown };
afterEach(() => {
  delete globalRuntime.bkeGoogleIdentityApplication;
  vi.unstubAllEnvs();
});
describe("Google-only authentication startup dependencies", () => {
  it("composes sign-in without email, payment, MFA or licensing configuration", async () => {
    delete globalRuntime.bkeGoogleIdentityApplication;
    vi.stubEnv("DATABASE_URL", "postgresql://fixture:fixture@localhost:5432/not-contacted");
    vi.stubEnv("SESSION_SECRET", "s".repeat(64));
    for (const key of ["MFA_ENCRYPTION_KEY", "ADMIN_OWNER_RECOVERY_KEY", "RESEND_API_KEY",
      "EMAIL_PROVIDER", "EMAIL_FROM", "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "LICENSE_PEPPER"]) {
      vi.stubEnv(key, undefined);
    }
    const application = await getIdentityWebApplication();
    expect(application.has(IDENTITY_GOOGLE_AUTHENTICATION_CAPABILITY_ID)).toBe(true);
    expect(application.capabilityIds).not.toEqual(expect.arrayContaining([
      "bke.identity.password-authentication.v1", "bke.identity.magic-login-request.v1",
      "bke.identity.login-mfa-verification.v1",
    ]));
  });
});

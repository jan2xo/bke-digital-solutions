import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("native BKE customer registration", () => {
  it("keeps native registration behind the native protocol and out of browser session creation", () => {
    const preflight = read("app/api/agent-sessions/native/registration/route.ts");
    const register = read("app/api/agent-sessions/native/register/route.ts");
    const verify = read("app/api/agent-sessions/native/verify-email/route.ts");
    const resend = read("app/api/agent-sessions/native/verification/resend/route.ts");

    for (const route of [preflight, register, verify, resend]) {
      expect(route).toContain("rejectBrowserOriginForAgent(request)");
      expect(route).toContain("requireAgentAccountSessionProtocol(request)");
      expect(route).not.toContain("createSession");
      expect(route).not.toContain("assertSameOrigin");
      expect(route).not.toContain("console.log");
    }
  });

  it("requires the currently published registration legal versions", () => {
    const preflight = read("app/api/agent-sessions/native/registration/route.ts");
    const register = read("app/api/agent-sessions/native/register/route.ts");
    const authority = read("apps/web/auth/native-customer-registration.ts");

    expect(preflight).toContain("registrationLegalDocuments");
    expect(preflight).toContain("currentPublishedVersionId");
    expect(register).toContain("legal_version_ids");
    expect(authority).toContain("recordLegalAcceptances");
    expect(authority).toContain('"REGISTRATION"');
  });

  it("uses a hashed one-time verification code and never reflects it to the native client", () => {
    const authority = read("apps/web/auth/native-customer-registration.ts");
    const register = read("app/api/agent-sessions/native/register/route.ts");
    const resend = read("app/api/agent-sessions/native/verification/resend/route.ts");

    expect(authority).toContain('"VERIFY_EMAIL_NATIVE"');
    expect(authority).toContain("hashToken(code)");
    expect(authority).toContain("sendNativeVerificationCode");
    expect(register).not.toContain("verification_code");
    expect(register).not.toContain("token:");
    expect(resend).not.toContain("verification_code");
    expect(resend).not.toContain("token:");
  });

  it("invalidates outstanding browser and native verification tokens after success", () => {
    const authority = read("apps/web/auth/native-customer-registration.ts");

    expect(authority).toContain('"VERIFY_EMAIL"');
    expect(authority).toContain('"VERIFY_EMAIL_NATIVE"');
    expect(authority).toContain("emailVerified: now");
    expect(authority).toContain("usedAt: null");
  });

  it("keeps resend enumeration-resistant", () => {
    const resend = read("app/api/agent-sessions/native/verification/resend/route.ts");

    expect(resend).toContain('status: "accepted"');
    expect(resend).not.toContain("ACCOUNT_NOT_FOUND");
    expect(resend).not.toContain("email_sent");
  });
});

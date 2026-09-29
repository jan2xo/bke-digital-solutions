import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("native BKE customer MFA authority", () => {
  it("pins the immutable Identity 0.4.0 authority and provenance", () => {
    const pkg = read("package.json");
    const workflow = read(".github/workflows/v2-identity.yml");
    expect(pkg).toContain("identity-v0.4.0/bke-identity-0.4.0.tgz");
    expect(workflow).toContain("identity-v0.4.0/bke-identity-0.4.0.tgz");
    expect(workflow).toContain("4b5ead5c9aee8fe1e1b67876711a423c033a8ad81d6a9b0a54b42548d59222ad");
  });

  it("requires MFA-enabled customers to complete a challenge before handoff", () => {
    const login = read("app/api/agent-sessions/native/login/route.ts");
    const verify = read("app/api/agent-sessions/native/mfa/verify/route.ts");
    expect(login).toContain('authenticated.route === "MFA_CHALLENGE"');
    expect(login).toContain('status: "mfa_challenge_required"');
    expect(login).toContain('authenticated.route !== "SESSION"');
    expect(login).not.toContain("CUSTOMER_SESSION");
    expect(verify).toContain("IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID");
    expect(verify).toContain("completeNativeBkeHandoff");
  });

  it("keeps every account MFA route behind Agent protocol and authenticated session identity", () => {
    for (const path of [
      "app/api/agent-sessions/account/mfa/route.ts",
      "app/api/agent-sessions/account/mfa/enroll/start/route.ts",
      "app/api/agent-sessions/account/mfa/enroll/complete/route.ts",
      "app/api/agent-sessions/account/mfa/challenge/route.ts",
      "app/api/agent-sessions/account/mfa/disable/route.ts",
      "app/api/agent-sessions/account/mfa/recovery/regenerate/route.ts",
    ]) {
      const route = read(path);
      expect(route).toContain("rejectBrowserOriginForAgent(request)");
      expect(route).toContain("requireAgentAccountSessionProtocol(request)");
      expect(route).toContain("authenticateNativeAgentRequest(request)");
      expect(route).not.toContain("console.log");
    }
  });

  it("requires fresh password proof for MFA enrollment and destructive account-security mutations", () => {
    for (const path of [
      "app/api/agent-sessions/account/mfa/enroll/start/route.ts",
      "app/api/agent-sessions/account/mfa/enroll/complete/route.ts",
      "app/api/agent-sessions/account/mfa/challenge/route.ts",
      "app/api/agent-sessions/account/mfa/disable/route.ts",
      "app/api/agent-sessions/account/mfa/recovery/regenerate/route.ts",
    ]) {
      const route = read(path);
      expect(route).toContain("current_password");
      expect(route).toContain("verifyNativeCurrentPassword");
    }
  });

  it("forces reauthentication after MFA assurance changes and blocks stale Agent sessions", () => {
    const complete = read("app/api/agent-sessions/account/mfa/enroll/complete/route.ts");
    const disable = read("app/api/agent-sessions/account/mfa/disable/route.ts");
    const recovery = read("app/api/agent-sessions/account/mfa/recovery/regenerate/route.ts");
    const sessionAuthority = read("apps/web/agent-sessions/device-authorization.ts");
    expect(complete).toContain("revokeNativeAgentSessionsForUser");
    expect(disable).toContain("revokeNativeAgentSessionsForUser");
    expect(recovery).toContain("revokeNativeAgentSessionsForUser");
    expect(recovery).toContain("issueTransientNativeMfaSession");
    expect(sessionAuthority).toContain("agentSessionPredatesMfaAuthorityChange");
    expect(sessionAuthority).toContain("enabledAt");
    expect(sessionAuthority).toContain("disabledAt");
  });

  it("keeps native registration protocol-bound, legal-version-bound, and secret-safe", () => {
    const preflight = read("app/api/agent-sessions/native/registration/route.ts");
    const register = read("app/api/agent-sessions/native/register/route.ts");
    const verify = read("app/api/agent-sessions/native/verify-email/route.ts");
    const resend = read("app/api/agent-sessions/native/verification/resend/route.ts");
    const authority = read("apps/web/auth/native-customer-registration.ts");

    for (const route of [preflight, register, verify, resend]) {
      expect(route).toContain("rejectBrowserOriginForAgent(request)");
      expect(route).toContain("requireAgentAccountSessionProtocol(request)");
      expect(route).not.toContain("createSession");
      expect(route).not.toContain("console.log");
    }

    expect(preflight).toContain("registrationLegalDocuments");
    expect(preflight).toContain("currentPublishedVersionId");
    expect(preflight).toContain("content_markdown");
    expect(preflight).toContain("applyLegalVariables");
    expect(register).toContain("legal_version_ids");
    expect(authority).toContain("recordLegalAcceptances");
    expect(authority).toContain('"REGISTRATION"');
    expect(authority).toContain('"VERIFY_EMAIL_NATIVE"');
    expect(authority).toContain("hashToken(code)");
    expect(verify).toContain("verifyNativeCustomerEmail");
    const browserVerify = read("app/api/auth/verify/route.ts");
    expect(browserVerify).toContain('row.purpose !== "VERIFY_EMAIL"');
    expect(register).not.toContain("verification_code");
    expect(resend).not.toContain("verification_code");
    expect(resend).toContain('status: "accepted"');
  });

  it("proves native registration, token rotation, legal acceptance, and verification against the exact-head database", () => {
    execFileSync(
      "npx",
      ["tsx", "tests/native-bke-registration.certify.ts"],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          NODE_OPTIONS: "--conditions=react-server",
          APP_URL: "https://native-cert.bke.test",
          SESSION_SECRET:
            "native-registration-cert-session-secret-0000000001",
          LICENSE_PEPPER:
            "native-registration-cert-license-pepper-0000000001",
          CRON_SECRET:
            "native-registration-cert-cron-secret-000000000001",
          S3_BUCKET: "bke-native-registration-cert",
          EMAIL_FROM: "cert@bke.test",
        },
      },
    );
  }, 30_000);

  it("keeps customer privacy requests behind authenticated Agent-session account scope", () => {
    const route = read("app/api/agent-sessions/privacy/requests/route.ts");

    expect(route).toContain("rejectBrowserOriginForAgent(request)");
    expect(route).toContain("requireAgentAccountSessionProtocol(request)");
    expect(route).toContain("authenticateNativeAgentRequest(request)");
    expect(route).toContain("PRIVACY_REQUEST_TYPES");
    expect(route).toContain("accountId: session.accountId");
    expect(route).not.toContain("user_id:");
    expect(route).not.toContain("account_id: z.");
    expect(route).not.toContain("access_token:");
    expect(route).not.toContain("refresh_token:");
    expect(route).not.toContain("handoff_code:");
    expect(route).not.toContain("console.log");
  });

  it("proves selected-account privacy request persistence and visibility boundaries", () => {
    execFileSync(
      "npx",
      ["tsx", "tests/agent-session-privacy-requests.certify.ts"],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          NODE_OPTIONS: "--conditions=react-server",
        },
      },
    );
  }, 30_000);

  it("never returns password material and returns recovery codes only from Identity mutation results", () => {
    const helper = read("apps/web/agent-sessions/native-mfa.ts");
    const complete = read("app/api/agent-sessions/account/mfa/enroll/complete/route.ts");
    const recovery = read("app/api/agent-sessions/account/mfa/recovery/regenerate/route.ts");
    expect(helper).not.toContain("console.log");
    expect(complete).toContain("recovery_codes: result.recoveryCodes");
    expect(recovery).toContain("recovery_codes: result.recoveryCodes");
    const completeResponses =
      complete.match(/return response\(\{[^}]*\}/g)?.join("\n") ?? "";
    const recoveryResponses =
      recovery.match(/return response\(\{[^}]*\}/g)?.join("\n") ?? "";
    expect(completeResponses).not.toContain("current_password");
    expect(recoveryResponses).not.toContain("current_password");
  });
});

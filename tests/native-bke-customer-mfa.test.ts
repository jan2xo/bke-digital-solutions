import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Google-only authentication and Agent assurance boundary", () => {
  it("pins the immutable Identity 0.5.0 artifact and digest", () => {
    const pkg = read("package.json");
    const workflow = read(".github/workflows/v2-identity.yml");

    expect(pkg).toContain("identity-v0.5.0/bke-identity-0.5.0.tgz");
    expect(workflow).toContain("identity-v0.5.0/bke-identity-0.5.0.tgz");
    expect(workflow).toContain(
      "d78e365d2db23044fe1175114affb540823599380c5dda85042dfe8073e1a2b9",
    );
  });

  it("retires native password login and MFA grants with a no-store Google handoff response", async () => {
    const login = await import("../app/api/agent-sessions/native/login/route");
    const verify = await import("../app/api/agent-sessions/native/mfa/verify/route");

    for (const response of [await login.POST(), await verify.POST()]) {
      expect(response.status).toBe(410);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.json()).toEqual({
        error: "GOOGLE_BROWSER_HANDOFF_REQUIRED",
      });
    }
  });

  it("keeps read-only Agent MFA status authenticated and retires native MFA mutations", () => {
    const statusRoute = read("app/api/agent-sessions/account/mfa/route.ts");
    expect(statusRoute).toContain("export async function GET(request: Request)");
    expect(statusRoute).toContain("rejectBrowserOriginForAgent(request)");
    expect(statusRoute).toContain("requireAgentAccountSessionProtocol(request)");
    expect(statusRoute).toContain("authenticateNativeAgentRequest(request)");

    for (const path of [
      "app/api/agent-sessions/account/mfa/enroll/start/route.ts",
      "app/api/agent-sessions/account/mfa/enroll/complete/route.ts",
      "app/api/agent-sessions/account/mfa/challenge/route.ts",
      "app/api/agent-sessions/account/mfa/disable/route.ts",
      "app/api/agent-sessions/account/mfa/recovery/regenerate/route.ts",
    ]) {
      expect(read(path)).toContain("nativeSecurityMutationRetired");
    }
  });

  it("does not accept native password proofs for MFA enrollment or security mutations", () => {
    const retired = read("apps/web/auth/retired-auth.ts");
    expect(retired).toContain("BROWSER_SECURITY_REQUIRED");

    for (const path of [
      "app/api/agent-sessions/account/mfa/enroll/start/route.ts",
      "app/api/agent-sessions/account/mfa/enroll/complete/route.ts",
      "app/api/agent-sessions/account/mfa/challenge/route.ts",
      "app/api/agent-sessions/account/mfa/disable/route.ts",
      "app/api/agent-sessions/account/mfa/recovery/regenerate/route.ts",
    ]) {
      const route = read(path);
      expect(route).toContain("nativeSecurityMutationRetired");
      expect(route).not.toContain("current_password");
      expect(route).not.toContain("verifyNativeCurrentPassword");
    }
  });

  it("retains stale Agent-session MFA epoch checks independently of retired password routes", () => {
    const authority = read("apps/web/agent-sessions/device-authorization.ts");

    expect(authority).toContain("agentSessionPredatesMfaAuthorityChange");
    expect(authority).toContain("enabledAt");
    expect(authority).toContain("disabledAt");
  });

  it("keeps the recent-auth timestamp scoped to the Agent session and retires its password API", async () => {
    const migration = read(
      "prisma/migrations/20261001060000_agent_session_recent_auth/migration.sql",
    );
    const helper = read("apps/web/agent-sessions/recent-auth.ts");
    const start = read(
      "app/api/agent-sessions/account/recent-auth/start/route.ts",
    );
    const complete = read(
      "app/api/agent-sessions/account/recent-auth/complete/route.ts",
    );

    expect(migration).toContain('"recentAuthenticatedAt" TIMESTAMP(3)');
    expect(helper).toContain("AGENT_RECENT_AUTH_WINDOW_MINUTES = 15");
    expect(helper).toContain('"recentAuthenticatedAt" = ${now}');
    expect(helper).toContain('"id" = ${input.sessionId}');
    expect(helper).toContain('"userId" = ${input.userId}');
    expect(helper).toContain('"accountId" = ${input.accountId}');
    expect(helper).toContain('"deviceId" = ${input.deviceId}');
    expect(helper).toContain('"revokedAt" IS NULL');
    expect(helper).toContain('"AGENT_RECENT_AUTH_VERIFIED"');
    expect(helper).not.toContain("challenge_token");
    expect(helper).not.toContain("codeHash");
    expect(start).toContain("nativeSecurityMutationRetired");
    expect(complete).toContain("nativeSecurityMutationRetired");

    const { POST } = await import(
      "../app/api/agent-sessions/account/recent-auth/start/route"
    );
    const response = await POST();
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("binds registration to the stable Google subject and accepted legal versions", () => {
    const callback = read("app/api/auth/google/callback/route.ts");
    const registration = read("apps/web/auth/google-registration.ts");

    expect(callback).toContain("registerGoogleCustomer");
    expect(callback).toContain("subject");
    expect(registration).toContain("createPrismaTransactionGoogleIdentityRepository(tx)");
    expect(registration).toContain("recordLegalAcceptances");
    expect(registration).toContain("selectedVersionIds: [...input.legalVersionIds]");
    expect(registration).toContain('purpose: "VERIFY_EMAIL"');

    const nativeRegister = read("app/api/agent-sessions/native/register/route.ts");
    expect(nativeRegister).toContain("nativePasswordAuthRetired");
  });

  it("certifies Google registration, contact-code rotation, legal acceptance, and verification in PostgreSQL", () => {
    execFileSync(
      "npx",
      ["tsx", "tests/native-bke-registration.certify.ts"],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          NODE_OPTIONS: "--conditions=react-server",
          APP_URL: "https://jl-bke.com",
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

  it("never returns password material or recovery codes through retired native security mutations", async () => {
    const helper = read("apps/web/agent-sessions/native-mfa.ts");
    expect(helper).not.toContain("console.log");
    const change = await import(
      "../app/api/agent-sessions/account/mfa/recovery/regenerate/route"
    );
    const response = await change.POST();
    const body = await response.text();

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(body).toBe(JSON.stringify({ error: "BROWSER_SECURITY_REQUIRED" }));
    expect(body).not.toMatch(/password|recovery_codes|secret/i);
  });

  it("keeps organization overview bound to the authenticated Agent principal and selected account", () => {
    const route = read("app/api/agent-sessions/account/organization/route.ts");
    const authority = read("apps/web/accounts/agent-organization-overview.ts");

    expect(route).toContain("rejectBrowserOriginForAgent(request)");
    expect(route).toContain("requireAgentAccountSessionProtocol(request)");
    expect(route).toContain("authenticateNativeAgentRequest(request)");
    expect(route).toContain("accountId: authenticated.accountId");
    expect(route).toContain("principalId: authenticated.userId");
    expect(route).not.toContain("user_id");
    expect(route).not.toContain("account_id");
    expect(route).not.toContain("access_token");
    expect(route).not.toContain("refresh_token");
    expect(route).not.toContain("handoff_code");
    expect(route).not.toContain("console.log");

    expect(authority).toContain("ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID");
    expect(authority).toContain("roleHasAccountsCapability");
    expect(authority).toContain('"MANAGE_MEMBERS"');
    expect(authority).toContain('"VIEW_PAYMENTS"');
    expect(authority).toContain('"VIEW_LICENSES"');
    expect(authority).not.toContain("tokenHash");
    expect(authority).not.toContain("ownerId:");
  });

  it("proves role-filtered selected-account organization overview against the exact-head database", () => {
    execFileSync(
      "npx",
      ["tsx", "tests/agent-session-organization-overview.certify.ts"],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          NODE_OPTIONS: "--conditions=react-server",
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


});

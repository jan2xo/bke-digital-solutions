import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const agentOrganizationMocks = vi.hoisted(() => ({
  authenticateNativeAgentRequest: vi.fn(),
  createOrganizationAccount: vi.fn(),
  rateLimit: vi.fn(),
  getV2WebApplication: vi.fn(),
  checkLegalReacceptance: vi.fn(),
  db: {
    user: {
      findUnique: vi.fn(),
    },
  },
  getRuntimeEnvironment: vi.fn(),
}));

vi.mock("@/apps/web/agent-sessions/native-mfa", () => ({
  authenticateNativeAgentRequest:
    agentOrganizationMocks.authenticateNativeAgentRequest,
}));
vi.mock("@/apps/web/accounts/organization-operations", () => ({
  createOrganizationAccount:
    agentOrganizationMocks.createOrganizationAccount,
}));
vi.mock("@/apps/web/http/rate-limit", () => ({
  rateLimit: agentOrganizationMocks.rateLimit,
}));
vi.mock("@/apps/web/runtime", () => ({
  getV2WebApplication: agentOrganizationMocks.getV2WebApplication,
}));
vi.mock("@/platform/host/db", () => ({
  db: agentOrganizationMocks.db,
}));
vi.mock("@/platform/host/env", () => ({
  getRuntimeEnvironment:
    agentOrganizationMocks.getRuntimeEnvironment,
}));

describe("native BKE account handoff", () => {
  it("validates credentials through the released Identity capability without creating a browser session", () => {
    const route = read("app/api/agent-sessions/native/login/route.ts");
    expect(route).toContain("IDENTITY_PASSWORD_AUTHENTICATION_CAPABILITY_ID");
    expect(route).toContain("passwordAuthentication.authenticate");
    expect(route).toContain("rejectBrowserOriginForAgent");
    expect(route).toContain("requireAgentAccountSessionProtocol");
    expect(route).not.toContain("createSession");
    expect(route).not.toContain("writeIdentitySessionCookie");
    expect(route).not.toContain("cookies()");
  });

  it("keeps password material out of the persisted handoff and supports account selection", () => {
    const route = read("app/api/agent-sessions/native/login/route.ts");
    const composition = read("apps/web/agent-sessions/native-mfa.ts");
    const helper = read("apps/web/agent-sessions/native-handoff.ts");
    expect(composition).toContain('status: "account_selection_required"');
    expect(composition).toContain("resolveNativeBkeAccounts");
    expect(composition).toContain("issueNativeBkeAgentHandoff");
    expect(route).toContain("customer_account_id");
    expect(route).toContain("handoff_code");
    expect(helper).not.toContain("password");
    expect(helper).toContain("'NATIVE_HANDOFF', 'APPROVED'");
    expect(helper).toContain("hashAgentDeviceCode(handoffCode");
    expect(helper).not.toContain('"handoffCode"');
  });

  it("binds native handoff exchange to the intended device and expires approved grants", () => {
    const service = read("apps/web/agent-sessions/device-authorization.ts");
    const tokenRoute = read("app/api/agent-sessions/device/token/route.ts");
    expect(service).toContain('authorizationKind: "DEVICE_CODE" | "NATIVE_HANDOFF"');
    expect(service).toContain('authorization.authorizationKind === "NATIVE_HANDOFF"');
    expect(service).toContain("input.deviceId.trim() !== authorization.deviceId");
    expect(service).toContain('authorization.status === "APPROVED" && authorization.expiresAt <= now');
    expect(tokenRoute).toContain("device_id");
    expect(tokenRoute).toContain("deviceId: input.device_id");
  });

  it("keeps legacy device-code authorization distinct and migration-safe", () => {
    const migration = read(
      "prisma/migrations/20260923170000_v3_native_bke_account_handoff/migration.sql",
    );
    expect(migration).toContain('"authorizationKind" TEXT NOT NULL DEFAULT \'DEVICE_CODE\'');
    expect(migration).toContain("'DEVICE_CODE','NATIVE_HANDOFF'");
    expect(migration).not.toContain("V2_");
    expect(migration).not.toContain("V3_");
  });
});


describe("native Agent organization creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentOrganizationMocks.getRuntimeEnvironment.mockReturnValue({
      AGENT_ACCOUNT_SESSION_ENABLED: true,
    });
    agentOrganizationMocks.authenticateNativeAgentRequest.mockResolvedValue({
      status: "authenticated",
      userId: "user-cert",
      accountId: "selected-account-cert",
      sessionId: "agent-session-cert",
      deviceId: "device-cert",
    });
    agentOrganizationMocks.rateLimit.mockResolvedValue({ allowed: true });
    agentOrganizationMocks.db.user.findUnique.mockResolvedValue({
      emailVerified: new Date("2026-09-29T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    agentOrganizationMocks.checkLegalReacceptance.mockResolvedValue({
      status: "CURRENT",
    });
    agentOrganizationMocks.getV2WebApplication.mockResolvedValue({
      get: () => ({
        check: agentOrganizationMocks.checkLegalReacceptance,
      }),
    });
    agentOrganizationMocks.createOrganizationAccount.mockResolvedValue({
      id: "account-must-not-leak",
      type: "ORGANIZATION",
      displayName: "Certification Org",
      ownerId: "user-cert",
    });
  });

  function request(
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return new Request(
      "https://digital-solutions.example.test/api/agent-sessions/account/organization/create",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bke-account-session-version":
            "bke.account-session.v1",
          ...headers,
        },
        body: JSON.stringify(body),
      },
    );
  }

  it("rejects browser-origin mutation before Agent authentication", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/create/route"
    );
    const response = await POST(request({}, {
      origin: "https://browser.example.test",
    }));

    expect(response.status).toBe(403);
    expect(
      response.headers.get("x-bke-account-session-version"),
    ).toBe("bke.account-session.v1");
    expect(
      agentOrganizationMocks.authenticateNativeAgentRequest,
    ).not.toHaveBeenCalled();
  });

  it("preserves email-verification and Legal reacceptance gates", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/create/route"
    );

    agentOrganizationMocks.db.user.findUnique.mockResolvedValueOnce({
      emailVerified: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const unverified = await POST(request({
      display_name: "Certification Org",
      legal_name: "Certification Organization Legal",
      billing_email: "billing@example.test",
    }));
    expect(unverified.status).toBe(403);
    expect(await unverified.json()).toEqual({
      error: "EMAIL_NOT_VERIFIED",
    });
    expect(
      agentOrganizationMocks.checkLegalReacceptance,
    ).not.toHaveBeenCalled();

    agentOrganizationMocks.checkLegalReacceptance.mockResolvedValueOnce({
      status: "REACCEPTANCE_REQUIRED",
      pending: [],
    });
    const legal = await POST(request({
      display_name: "Certification Org",
      legal_name: "Certification Organization Legal",
      billing_email: "billing@example.test",
    }));
    expect(legal.status).toBe(409);
    expect(await legal.json()).toEqual({
      error: "LEGAL_REACCEPTANCE_REQUIRED",
    });
    expect(
      agentOrganizationMocks.createOrganizationAccount,
    ).not.toHaveBeenCalled();
  });

  it("creates under the authenticated principal without leaking mutation handles", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/create/route"
    );
    const response = await POST(request({
      display_name: "Certification Org",
      legal_name: "Certification Organization Legal",
      billing_email: "billing@example.test",
      registration_number: "REG-CERT-1",
      tax_id: "TAX-CERT-1",
    }));

    expect(response.status).toBe(201);
    expect(
      response.headers.get("x-bke-account-session-version"),
    ).toBe("bke.account-session.v1");
    expect(
      agentOrganizationMocks.checkLegalReacceptance,
    ).toHaveBeenCalledWith({
      principalId: "user-cert",
      principalEstablishedAt:
        new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(
      agentOrganizationMocks.createOrganizationAccount,
    ).toHaveBeenCalledWith({
      actorId: "user-cert",
      displayName: "Certification Org",
      legalName: "Certification Organization Legal",
      billingEmail: "billing@example.test",
      registrationNumber: "REG-CERT-1",
      taxId: "TAX-CERT-1",
    });

    const payload = await response.json();
    expect(payload).toEqual({
      status: "created",
      switch_required: true,
      account: {
        type: "ORGANIZATION",
        display_name: "Certification Org",
      },
    });
    expect(JSON.stringify(payload)).not.toContain(
      "account-must-not-leak",
    );
    expect(JSON.stringify(payload)).not.toContain(
      "selected-account-cert",
    );
  });

  it("rate limits creation and preserves the Agent protocol response", async () => {
    agentOrganizationMocks.rateLimit.mockResolvedValueOnce({
      allowed: false,
    });
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/create/route"
    );
    const response = await POST(request({
      display_name: "Certification Org",
      legal_name: "Certification Organization Legal",
      billing_email: "billing@example.test",
    }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "RATE_LIMITED",
    });
    expect(
      response.headers.get("x-bke-account-session-version"),
    ).toBe("bke.account-session.v1");
    expect(
      agentOrganizationMocks.createOrganizationAccount,
    ).not.toHaveBeenCalled();
  });
});

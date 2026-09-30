import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const agentOrganizationMocks = vi.hoisted(() => ({
  authenticateNativeAgentRequest: vi.fn(),
  createOrganizationAccount: vi.fn(),
  updateOrganizationProfile: vi.fn(),
  inviteOrganizationMember: vi.fn(),
  acceptOrganizationInvitation: vi.fn(),
  resendOrganizationInvitation: vi.fn(),
  revokeOrganizationInvitation: vi.fn(),
  expirePendingOrganizationInvitations: vi.fn(),
  updateOrganizationMemberRole: vi.fn(),
  removeOrganizationMember: vi.fn(),
  transferOrganizationOwnership: vi.fn(),
  leaveOrganization: vi.fn(),
  getAgentAccountPurchasesOverview: vi.fn(),
  rateLimit: vi.fn(),
  getV2WebApplication: vi.fn(),
  checkLegalReacceptance: vi.fn(),
  db: {
    user: {
      findUnique: vi.fn(),
    },
    invitation: {
      findMany: vi.fn(),
    },
    membership: {
      findMany: vi.fn(),
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
  updateOrganizationProfile:
    agentOrganizationMocks.updateOrganizationProfile,
  inviteOrganizationMember:
    agentOrganizationMocks.inviteOrganizationMember,
  acceptOrganizationInvitation:
    agentOrganizationMocks.acceptOrganizationInvitation,
  resendOrganizationInvitation:
    agentOrganizationMocks.resendOrganizationInvitation,
  revokeOrganizationInvitation:
    agentOrganizationMocks.revokeOrganizationInvitation,
  expirePendingOrganizationInvitations:
    agentOrganizationMocks.expirePendingOrganizationInvitations,
  updateOrganizationMemberRole:
    agentOrganizationMocks.updateOrganizationMemberRole,
  removeOrganizationMember:
    agentOrganizationMocks.removeOrganizationMember,
  transferOrganizationOwnership:
    agentOrganizationMocks.transferOrganizationOwnership,
  leaveOrganization:
    agentOrganizationMocks.leaveOrganization,
}));
vi.mock("@/apps/web/http/rate-limit", () => ({
  rateLimit: agentOrganizationMocks.rateLimit,
}));
vi.mock("@/apps/web/runtime", () => ({
  getV2WebApplication: agentOrganizationMocks.getV2WebApplication,
}));
vi.mock("@/apps/web/accounts/agent-account-purchases-overview", () => ({
  getAgentAccountPurchasesOverview:
    agentOrganizationMocks.getAgentAccountPurchasesOverview,
}));
vi.mock("@/platform/host/db", () => ({
  db: agentOrganizationMocks.db,
}));
vi.mock("@/platform/host/env", () => ({
  env: {
    SESSION_SECRET:
      "native-organization-handle-cert-session-secret-0000000001",
  },
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


describe("native Agent organization profile update", () => {
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
    agentOrganizationMocks.updateOrganizationProfile.mockResolvedValue({
      id: "selected-account-cert",
    });
  });

  function profileRequest(
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return new Request(
      "https://digital-solutions.example.test/api/agent-sessions/account/organization/profile",
      {
        method: "PATCH",
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

  it("rejects browser-origin profile mutation before Agent authentication", async () => {
    const { PATCH } = await import(
      "../app/api/agent-sessions/account/organization/profile/route"
    );
    const response = await PATCH(profileRequest({}, {
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

  it("binds organization profile mutation to the authenticated selected account", async () => {
    const { PATCH } = await import(
      "../app/api/agent-sessions/account/organization/profile/route"
    );
    const response = await PATCH(profileRequest({
      display_name: "Renamed Certification Org",
      legal_name: "Renamed Certification Organization Legal",
      billing_email: "billing-renamed@example.test",
      registration_number: "REG-RENAMED",
      tax_id: null,
    }));

    expect(response.status).toBe(200);
    expect(
      agentOrganizationMocks.updateOrganizationProfile,
    ).toHaveBeenCalledWith({
      actorId: "user-cert",
      accountId: "selected-account-cert",
      displayName: "Renamed Certification Org",
      legalName: "Renamed Certification Organization Legal",
      billingEmail: "billing-renamed@example.test",
      registrationNumber: "REG-RENAMED",
      taxId: null,
    });
    const payload = await response.json();
    expect(payload).toEqual({ status: "updated" });
    expect(JSON.stringify(payload)).not.toContain(
      "selected-account-cert",
    );
    expect(JSON.stringify(payload)).not.toContain(
      "user-cert",
    );
  });

  it("rejects empty profile mutations before Accounts authority", async () => {
    const { PATCH } = await import(
      "../app/api/agent-sessions/account/organization/profile/route"
    );
    const response = await PATCH(profileRequest({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "INVALID_INPUT",
    });
    expect(
      agentOrganizationMocks.updateOrganizationProfile,
    ).not.toHaveBeenCalled();
  });

  it("preserves Accounts role denial and Agent protocol headers", async () => {
    agentOrganizationMocks.updateOrganizationProfile.mockRejectedValueOnce(
      new Error("ACCOUNT_ROLE_FORBIDDEN"),
    );
    const { PATCH } = await import(
      "../app/api/agent-sessions/account/organization/profile/route"
    );
    const response = await PATCH(profileRequest({
      display_name: "Forbidden Rename",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "ACCOUNT_ROLE_FORBIDDEN",
    });
    expect(
      response.headers.get("x-bke-account-session-version"),
    ).toBe("bke.account-session.v1");
  });
});


describe("native Agent organization invitation issuance", () => {
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
    agentOrganizationMocks.inviteOrganizationMember.mockResolvedValue({
      invitation: {
        id: "invitation-id-must-not-leak",
        accountId: "selected-account-cert",
        email: "member@example.test",
        role: "MEMBER",
        status: "PENDING",
        tokenHash: "invitation-hash-must-not-leak",
        expiresAt: new Date("2026-10-07T00:00:00.000Z"),
        createdAt: new Date("2026-09-30T00:00:00.000Z"),
      },
      token: "one-time-invitation-code-cert",
    });
  });

  function inviteRequest(
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return new Request(
      "https://digital-solutions.example.test/api/agent-sessions/account/organization/invitations/create",
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

  it("rejects browser-origin invitation mutation before Agent authentication", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/invitations/create/route"
    );
    const response = await POST(inviteRequest({}, {
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

  it("binds invitation issuance to the authenticated selected Organization and projects only the one-time invite secret", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/invitations/create/route"
    );
    const response = await POST(inviteRequest({
      email: "member@example.test",
      role: "MEMBER",
    }));

    expect(response.status).toBe(201);
    expect(
      agentOrganizationMocks.inviteOrganizationMember,
    ).toHaveBeenCalledWith({
      actorId: "user-cert",
      accountId: "selected-account-cert",
      email: "member@example.test",
      role: "MEMBER",
    });

    const payload = await response.json();
    expect(payload).toEqual({
      status: "created",
      invitation: {
        email: "member@example.test",
        role: "MEMBER",
        status: "PENDING",
        expires_at: "2026-10-07T00:00:00.000Z",
        created_at: "2026-09-30T00:00:00.000Z",
      },
      invitation_code: "one-time-invitation-code-cert",
    });
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain("invitation-id-must-not-leak");
    expect(wire).not.toContain("invitation-hash-must-not-leak");
    expect(wire).not.toContain("selected-account-cert");
    expect(wire).not.toContain("user-cert");
  });

  it("preserves Accounts role denial without projecting an invitation code", async () => {
    agentOrganizationMocks.inviteOrganizationMember.mockRejectedValueOnce(
      new Error("ACCOUNT_ROLE_FORBIDDEN"),
    );
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/invitations/create/route"
    );
    const response = await POST(inviteRequest({
      email: "member@example.test",
      role: "MEMBER",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "ACCOUNT_ROLE_FORBIDDEN",
    });
    expect(
      response.headers.get("x-bke-account-session-version"),
    ).toBe("bke.account-session.v1");
  });

  it("rejects invalid invitation input before Accounts authority", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/invitations/create/route"
    );
    const response = await POST(inviteRequest({
      email: "not-an-email",
      role: "SUPERUSER",
      account_id: "caller-must-not-select-account",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "INVALID_INPUT",
    });
    expect(
      agentOrganizationMocks.inviteOrganizationMember,
    ).not.toHaveBeenCalled();
  });
});


describe("native Agent organization invitation acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentOrganizationMocks.getRuntimeEnvironment.mockReturnValue({
      AGENT_ACCOUNT_SESSION_ENABLED: true,
    });
    agentOrganizationMocks.authenticateNativeAgentRequest.mockResolvedValue({
      status: "authenticated",
      userId: "recipient-user-cert",
      accountId: "current-selected-account-cert",
      sessionId: "agent-session-cert",
      deviceId: "device-cert",
    });
    agentOrganizationMocks.rateLimit.mockResolvedValue({ allowed: true });
    agentOrganizationMocks.db.user.findUnique.mockResolvedValue({
      email: "recipient@example.test",
    });
    agentOrganizationMocks.expirePendingOrganizationInvitations.mockResolvedValue(
      undefined,
    );
    agentOrganizationMocks.acceptOrganizationInvitation.mockResolvedValue({
      accountId: "invited-organization-id-must-not-leak",
      userId: "recipient-user-cert",
      role: "LICENSE_MANAGER",
      createdAt: new Date("2026-09-30T00:00:00.000Z"),
    });
  });

  function acceptRequest(
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return new Request(
      "https://digital-solutions.example.test/api/agent-sessions/account/organization/invitations/accept",
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

  it("rejects browser-origin acceptance before Agent authentication", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/invitations/accept/route"
    );
    const response = await POST(acceptRequest({
      invitation_code:
        "organization-invitation-code-cert-0123456789",
    }, {
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

  it("binds acceptance to the authenticated identity and keeps the selected account out of destination authority", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/invitations/accept/route"
    );
    const response = await POST(acceptRequest({
      invitation_code:
        "organization-invitation-code-cert-0123456789",
    }));

    expect(response.status).toBe(201);
    expect(
      agentOrganizationMocks.db.user.findUnique,
    ).toHaveBeenCalledWith({
      where: { id: "recipient-user-cert" },
      select: { email: true },
    });
    expect(
      agentOrganizationMocks.expirePendingOrganizationInvitations,
    ).toHaveBeenCalledTimes(1);
    expect(
      agentOrganizationMocks.acceptOrganizationInvitation,
    ).toHaveBeenCalledWith({
      userId: "recipient-user-cert",
      email: "recipient@example.test",
      token: "organization-invitation-code-cert-0123456789",
    });

    const payload = await response.json();
    expect(payload).toEqual({
      status: "accepted",
      role: "LICENSE_MANAGER",
      switch_required: true,
    });
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain("current-selected-account-cert");
    expect(wire).not.toContain(
      "invited-organization-id-must-not-leak",
    );
    expect(wire).not.toContain("recipient-user-cert");
    expect(wire).not.toContain("recipient@example.test");
    expect(
      response.headers.get("x-bke-account-session-version"),
    ).toBe("bke.account-session.v1");
  });

  it("accepts only the one-time invitation code from the caller", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/invitations/accept/route"
    );

    for (const body of [
      {
        invitation_code:
          "organization-invitation-code-cert-0123456789",
        account_id: "caller-selected-account",
      },
      {
        invitation_code:
          "organization-invitation-code-cert-0123456789",
        user_id: "caller-selected-user",
      },
      {
        invitation_code:
          "organization-invitation-code-cert-0123456789",
        email: "attacker@example.test",
      },
      {
        invitation_code:
          "organization-invitation-code-cert-0123456789",
        role: "OWNER",
      },
      { invitation_code: "too-short" },
    ]) {
      const response = await POST(acceptRequest(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "INVALID_INPUT",
      });
    }

    expect(
      agentOrganizationMocks.acceptOrganizationInvitation,
    ).not.toHaveBeenCalled();
  });

  it("fails closed when the authenticated principal no longer exists", async () => {
    agentOrganizationMocks.db.user.findUnique.mockResolvedValueOnce(
      null,
    );
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/invitations/accept/route"
    );
    const response = await POST(acceptRequest({
      invitation_code:
        "organization-invitation-code-cert-0123456789",
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "INVALID_TOKEN",
    });
    expect(
      agentOrganizationMocks.acceptOrganizationInvitation,
    ).not.toHaveBeenCalled();
  });

  it("preserves Accounts invitation rejection semantics", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/invitations/accept/route"
    );

    agentOrganizationMocks.acceptOrganizationInvitation.mockRejectedValueOnce(
      new Error("INVITATION_EMAIL_MISMATCH"),
    );
    const mismatch = await POST(acceptRequest({
      invitation_code:
        "organization-invitation-code-cert-0123456789",
    }));
    expect(mismatch.status).toBe(403);
    expect(await mismatch.json()).toEqual({
      error: "INVITATION_EMAIL_MISMATCH",
    });

    agentOrganizationMocks.acceptOrganizationInvitation.mockRejectedValueOnce(
      new Error("INVITATION_EXPIRED"),
    );
    const expired = await POST(acceptRequest({
      invitation_code:
        "organization-invitation-code-cert-0123456789",
    }));
    expect(expired.status).toBe(410);
    expect(await expired.json()).toEqual({
      error: "INVITATION_EXPIRED",
    });

    agentOrganizationMocks.acceptOrganizationInvitation.mockRejectedValueOnce(
      new Error("SUSPENDED_ACCOUNT"),
    );
    const suspended = await POST(acceptRequest({
      invitation_code:
        "organization-invitation-code-cert-0123456789",
    }));
    expect(suspended.status).toBe(409);
    expect(await suspended.json()).toEqual({
      error: "SUSPENDED_ACCOUNT",
    });
  });

  it("rate limits invitation acceptance without consuming the code", async () => {
    agentOrganizationMocks.rateLimit.mockResolvedValueOnce({
      allowed: false,
    });
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/invitations/accept/route"
    );
    const response = await POST(acceptRequest({
      invitation_code:
        "organization-invitation-code-cert-0123456789",
    }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "RATE_LIMITED",
    });
    expect(
      agentOrganizationMocks.expirePendingOrganizationInvitations,
    ).not.toHaveBeenCalled();
    expect(
      agentOrganizationMocks.acceptOrganizationInvitation,
    ).not.toHaveBeenCalled();
  });
});


describe("native Agent organization invitation management", () => {
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
    agentOrganizationMocks.db.invitation.findMany.mockResolvedValue([
      { id: "invitation-db-id-cert" },
    ]);
    agentOrganizationMocks.expirePendingOrganizationInvitations.mockResolvedValue({
      count: 0,
    });
    agentOrganizationMocks.resendOrganizationInvitation.mockResolvedValue({
      invitation: {
        id: "invitation-db-id-cert",
        accountId: "selected-account-cert",
        email: "member@example.test",
        role: "MEMBER",
        status: "PENDING",
        tokenHash: "rotated-token-hash-must-not-leak",
        expiresAt: new Date("2026-10-08T00:00:00.000Z"),
        createdAt: new Date("2026-09-30T00:00:00.000Z"),
      },
      token: "rotated-one-time-invitation-code-cert",
    });
    agentOrganizationMocks.revokeOrganizationInvitation.mockResolvedValue({
      id: "invitation-db-id-cert",
      accountId: "selected-account-cert",
      email: "member@example.test",
      role: "MEMBER",
      status: "REVOKED",
      tokenHash: "revoked-token-hash-must-not-leak",
      expiresAt: new Date("2026-10-07T00:00:00.000Z"),
      createdAt: new Date("2026-09-30T00:00:00.000Z"),
    });
  });

  let managementHandle = "";

  beforeEach(async () => {
    const {
      issueAgentOrganizationInvitationManagementHandle,
    } = await import(
      "../apps/web/accounts/agent-organization-invitation-management"
    );
    managementHandle =
      issueAgentOrganizationInvitationManagementHandle(
        "selected-account-cert",
        "invitation-db-id-cert",
      );
  });

  function manageRequest(
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return new Request(
      "https://digital-solutions.example.test/api/agent-sessions/account/organization/invitations/manage",
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

  it("keeps raw invitation IDs private while projecting scoped management handles", () => {
    const overview = read(
      "apps/web/accounts/agent-organization-overview.ts",
    );
    const route = read(
      "app/api/agent-sessions/account/organization/route.ts",
    );
    const handles = read(
      "apps/web/accounts/agent-organization-invitation-management.ts",
    );

    expect(overview).toContain(
      "issueAgentOrganizationInvitationManagementHandle",
    );
    expect(route).toContain(
      "management_handle: invitation.managementHandle",
    );
    expect(route).not.toContain(
      "id: invitation.id",
    );
    expect(handles).toContain(
      'createHmac("sha256", env.SESSION_SECRET)',
    );
    expect(handles).toContain(
      'HANDLE_DOMAIN = "bke.agent.organization.invitation.management.v1"',
    );
    expect(handles).toContain(
      'status: "PENDING"',
    );
    expect(handles).toContain(
      "safeEqual(expected, input.handle)",
    );
  });

  it("rejects browser-origin invitation management before Agent authentication", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/invitations/manage/route"
    );
    const response = await POST(manageRequest({
      action: "resend",
      management_handle: managementHandle,
    }, {
      origin: "https://browser.example.test",
    }));

    expect(response.status).toBe(403);
    expect(
      agentOrganizationMocks.authenticateNativeAgentRequest,
    ).not.toHaveBeenCalled();
  });

  it("resolves the opaque handle only inside the selected Organization and returns a fresh one-time code", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/invitations/manage/route"
    );
    const response = await POST(manageRequest({
      action: "resend",
      management_handle: managementHandle,
    }));

    expect(response.status).toBe(200);
    expect(
      agentOrganizationMocks.db.invitation.findMany,
    ).toHaveBeenCalledWith({
      where: {
        accountId: "selected-account-cert",
        status: "PENDING",
      },
      select: {
        id: true,
      },
    });
    expect(
      agentOrganizationMocks.resendOrganizationInvitation,
    ).toHaveBeenCalledWith({
      actorId: "user-cert",
      invitationId: "invitation-db-id-cert",
    });

    const payload = await response.json();
    expect(payload).toEqual({
      status: "resent",
      invitation: {
        email: "member@example.test",
        role: "MEMBER",
        status: "PENDING",
        expires_at: "2026-10-08T00:00:00.000Z",
        created_at: "2026-09-30T00:00:00.000Z",
      },
      invitation_code: "rotated-one-time-invitation-code-cert",
    });
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain("invitation-db-id-cert");
    expect(wire).not.toContain("selected-account-cert");
    expect(wire).not.toContain("rotated-token-hash-must-not-leak");
  });

  it("revokes through the resolved handle without returning a secret", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/invitations/manage/route"
    );
    const response = await POST(manageRequest({
      action: "revoke",
      management_handle: managementHandle,
    }));

    expect(response.status).toBe(200);
    expect(
      agentOrganizationMocks.revokeOrganizationInvitation,
    ).toHaveBeenCalledWith({
      actorId: "user-cert",
      invitationId: "invitation-db-id-cert",
    });

    const payload = await response.json();
    expect(payload).toEqual({
      status: "revoked",
      invitation: {
        email: "member@example.test",
        role: "MEMBER",
        status: "REVOKED",
        expires_at: "2026-10-07T00:00:00.000Z",
        created_at: "2026-09-30T00:00:00.000Z",
      },
    });
    expect(JSON.stringify(payload)).not.toContain(
      "invitation_code",
    );
  });

  it("fails closed for malformed, stale, or cross-account handles before mutation", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/invitations/manage/route"
    );

    const malformed = await POST(manageRequest({
      action: "resend",
      management_handle: "raw-invitation-id",
    }));
    expect(malformed.status).toBe(400);
    expect(
      agentOrganizationMocks.resendOrganizationInvitation,
    ).not.toHaveBeenCalled();

    agentOrganizationMocks.db.invitation.findMany.mockResolvedValueOnce(
      [],
    );
    const stale = await POST(manageRequest({
      action: "revoke",
      management_handle: managementHandle,
    }));
    expect(stale.status).toBe(404);
    expect(await stale.json()).toEqual({
      error: "INVITATION_NOT_FOUND",
    });
    expect(
      agentOrganizationMocks.revokeOrganizationInvitation,
    ).not.toHaveBeenCalled();

    const {
      issueAgentOrganizationInvitationManagementHandle,
    } = await import(
      "../apps/web/accounts/agent-organization-invitation-management"
    );
    const copiedFromAnotherAccount =
      issueAgentOrganizationInvitationManagementHandle(
        "other-account-cert",
        "invitation-db-id-cert",
      );
    const crossAccount = await POST(manageRequest({
      action: "resend",
      management_handle: copiedFromAnotherAccount,
    }));
    expect(crossAccount.status).toBe(404);
    expect(
      agentOrganizationMocks.resendOrganizationInvitation,
    ).not.toHaveBeenCalled();
  });

  it("preserves Accounts role denial and never projects a resend code", async () => {
    agentOrganizationMocks.resendOrganizationInvitation.mockRejectedValueOnce(
      new Error("ACCOUNT_ROLE_FORBIDDEN"),
    );
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/invitations/manage/route"
    );
    const response = await POST(manageRequest({
      action: "resend",
      management_handle: managementHandle,
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "ACCOUNT_ROLE_FORBIDDEN",
    });
  });
});


describe("native Agent organization member management", () => {
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
    agentOrganizationMocks.db.membership.findMany.mockResolvedValue([
      {
        userId: "member-user-id-cert",
        createdAt: new Date("2026-09-30T00:00:00.000Z"),
      },
    ]);
    agentOrganizationMocks.updateOrganizationMemberRole.mockResolvedValue({
      id: "membership-record-must-not-leak",
      accountId: "selected-account-cert",
      userId: "member-user-id-cert",
      role: "BILLING",
    });
    agentOrganizationMocks.removeOrganizationMember.mockResolvedValue({
      id: "membership-record-must-not-leak",
      accountId: "selected-account-cert",
      userId: "member-user-id-cert",
      role: "MEMBER",
    });
  });

  let managementHandle = "";

  beforeEach(async () => {
    const {
      issueAgentOrganizationMemberManagementHandle,
    } = await import(
      "../apps/web/accounts/agent-organization-member-management"
    );
    managementHandle =
      issueAgentOrganizationMemberManagementHandle(
        "selected-account-cert",
        "member-user-id-cert",
        new Date("2026-09-30T00:00:00.000Z"),
      );
  });

  function manageMemberRequest(
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return new Request(
      "https://digital-solutions.example.test/api/agent-sessions/account/organization/members/manage",
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

  it("keeps raw member IDs private while projecting scoped management handles", () => {
    const overview = read(
      "apps/web/accounts/agent-organization-overview.ts",
    );
    const route = read(
      "app/api/agent-sessions/account/organization/route.ts",
    );
    const handles = read(
      "apps/web/accounts/agent-organization-member-management.ts",
    );

    expect(overview).toContain(
      "issueAgentOrganizationMemberManagementHandle",
    );
    expect(route).toContain(
      "management_handle: member.managementHandle",
    );
    expect(route).not.toContain(
      "user_id: member",
    );
    expect(route).not.toContain(
      "membership_id",
    );
    expect(handles).toContain(
      'createHmac("sha256", env.SESSION_SECRET)',
    );
    expect(handles).toContain(
      'HANDLE_DOMAIN = "bke.agent.organization.member.management.v1"',
    );
    expect(handles).toContain(
      "where: { accountId: input.accountId }",
    );
    expect(handles).toContain(
      "safeEqual(expected, input.handle)",
    );
  });

  it("rejects browser-origin member management before Agent authentication", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/members/manage/route"
    );
    const response = await POST(manageMemberRequest({
      action: "remove",
      management_handle: managementHandle,
    }, {
      origin: "https://browser.example.test",
    }));

    expect(response.status).toBe(403);
    expect(
      agentOrganizationMocks.authenticateNativeAgentRequest,
    ).not.toHaveBeenCalled();
  });

  it("updates a member role through the selected-account scoped handle", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/members/manage/route"
    );
    const response = await POST(manageMemberRequest({
      action: "update_role",
      management_handle: managementHandle,
      role: "BILLING",
    }));

    expect(response.status).toBe(200);
    expect(
      agentOrganizationMocks.db.membership.findMany,
    ).toHaveBeenCalledWith({
      where: {
        accountId: "selected-account-cert",
      },
      select: {
        userId: true,
        createdAt: true,
      },
    });
    expect(
      agentOrganizationMocks.updateOrganizationMemberRole,
    ).toHaveBeenCalledWith({
      actorId: "user-cert",
      accountId: "selected-account-cert",
      userId: "member-user-id-cert",
      role: "BILLING",
    });
    expect(await response.json()).toEqual({
      status: "updated",
    });
  });

  it("removes a member through the selected-account scoped handle without reflecting identifiers", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/members/manage/route"
    );
    const response = await POST(manageMemberRequest({
      action: "remove",
      management_handle: managementHandle,
    }));

    expect(response.status).toBe(200);
    expect(
      agentOrganizationMocks.removeOrganizationMember,
    ).toHaveBeenCalledWith({
      actorId: "user-cert",
      accountId: "selected-account-cert",
      userId: "member-user-id-cert",
    });

    const payload = await response.json();
    expect(payload).toEqual({
      status: "removed",
    });
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain("membership-record-must-not-leak");
    expect(wire).not.toContain("member-user-id-cert");
    expect(wire).not.toContain("selected-account-cert");
  });

  it("fails closed for malformed, stale, cross-account, and widened member requests", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/members/manage/route"
    );

    const malformed = await POST(manageMemberRequest({
      action: "remove",
      management_handle: "raw-user-or-membership-id",
    }));
    expect(malformed.status).toBe(400);

    const widened = await POST(manageMemberRequest({
      action: "remove",
      management_handle: managementHandle,
      user_id: "caller-must-not-select-user",
    }));
    expect(widened.status).toBe(400);

    agentOrganizationMocks.db.membership.findMany.mockResolvedValueOnce(
      [],
    );
    const stale = await POST(manageMemberRequest({
      action: "remove",
      management_handle: managementHandle,
    }));
    expect(stale.status).toBe(404);
    expect(await stale.json()).toEqual({
      error: "MEMBER_NOT_FOUND",
    });

    const {
      issueAgentOrganizationMemberManagementHandle,
    } = await import(
      "../apps/web/accounts/agent-organization-member-management"
    );
    const copiedFromAnotherAccount =
      issueAgentOrganizationMemberManagementHandle(
        "other-account-cert",
        "member-user-id-cert",
        new Date("2026-09-30T00:00:00.000Z"),
      );
    const crossAccount = await POST(manageMemberRequest({
      action: "update_role",
      management_handle: copiedFromAnotherAccount,
      role: "MEMBER",
    }));
    expect(crossAccount.status).toBe(404);

    expect(
      agentOrganizationMocks.updateOrganizationMemberRole,
    ).not.toHaveBeenCalled();
    expect(
      agentOrganizationMocks.removeOrganizationMember,
    ).not.toHaveBeenCalled();
  });

  it("preserves Accounts last-owner protection", async () => {
    agentOrganizationMocks.updateOrganizationMemberRole.mockRejectedValueOnce(
      new Error("LAST_OWNER_REQUIRED"),
    );

    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/members/manage/route"
    );
    const response = await POST(manageMemberRequest({
      action: "update_role",
      management_handle: managementHandle,
      role: "MEMBER",
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "LAST_OWNER_REQUIRED",
    });
  });
});


describe("native Agent organization self-leave", () => {
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
    agentOrganizationMocks.leaveOrganization.mockResolvedValue({
      accountId: "selected-account-cert",
      userId: "user-cert",
      role: "MEMBER",
      createdAt: new Date("2026-09-30T00:00:00.000Z"),
    });
  });

  function leaveRequest(
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return new Request(
      "https://digital-solutions.example.test/api/agent-sessions/account/organization/leave",
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

  it("projects self-leave as Digital Solutions authority rather than Launcher role inference", () => {
    const overview = read(
      "apps/web/accounts/agent-organization-overview.ts",
    );
    const route = read(
      "app/api/agent-sessions/account/organization/route.ts",
    );
    expect(overview).toContain(
      'const leaveOrganization = access.effectiveRole !== "OWNER";',
    );
    expect(route).toContain(
      "leave_organization: overview.permissions.leaveOrganization",
    );
  });

  it("rejects browser-origin leave before Agent authentication", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/leave/route"
    );
    const response = await POST(leaveRequest({}, {
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

  it("binds self-leave to the authenticated principal and selected account", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/leave/route"
    );
    const response = await POST(leaveRequest({}));

    expect(response.status).toBe(200);
    expect(
      agentOrganizationMocks.leaveOrganization,
    ).toHaveBeenCalledWith({
      actorId: "user-cert",
      accountId: "selected-account-cert",
    });
    expect(await response.json()).toEqual({
      status: "left",
      reauthentication_required: true,
    });
    expect(
      response.headers.get("x-bke-account-session-version"),
    ).toBe("bke.account-session.v1");
  });

  it("rejects caller-selected account or member identifiers", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/leave/route"
    );

    for (const body of [
      { account_id: "caller-selected-account" },
      { user_id: "caller-selected-user" },
      { membership_id: "caller-selected-membership" },
      { owner_id: "caller-selected-owner" },
    ]) {
      const response = await POST(leaveRequest(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "INVALID_INPUT",
      });
    }

    expect(
      agentOrganizationMocks.leaveOrganization,
    ).not.toHaveBeenCalled();
  });

  it("preserves Accounts owner and missing-membership protections", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/leave/route"
    );

    agentOrganizationMocks.leaveOrganization.mockRejectedValueOnce(
      new Error("OWNER_CANNOT_LEAVE"),
    );
    const owner = await POST(leaveRequest({}));
    expect(owner.status).toBe(409);
    expect(await owner.json()).toEqual({
      error: "OWNER_CANNOT_LEAVE",
    });

    agentOrganizationMocks.leaveOrganization.mockRejectedValueOnce(
      new Error("MEMBER_NOT_FOUND"),
    );
    const missing = await POST(leaveRequest({}));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "MEMBER_NOT_FOUND",
    });
  });

  it("rate limits self-leave without invoking Accounts authority", async () => {
    agentOrganizationMocks.rateLimit.mockResolvedValueOnce({
      allowed: false,
    });
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/leave/route"
    );
    const response = await POST(leaveRequest({}));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "RATE_LIMITED",
    });
    expect(
      agentOrganizationMocks.leaveOrganization,
    ).not.toHaveBeenCalled();
  });
});


describe("native Agent organization ownership transfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentOrganizationMocks.getRuntimeEnvironment.mockReturnValue({
      AGENT_ACCOUNT_SESSION_ENABLED: true,
    });
    agentOrganizationMocks.authenticateNativeAgentRequest.mockResolvedValue({
      status: "authenticated",
      userId: "owner-user-cert",
      accountId: "selected-account-cert",
      sessionId: "agent-session-cert",
      deviceId: "device-cert",
    });
    agentOrganizationMocks.rateLimit.mockResolvedValue({ allowed: true });
    agentOrganizationMocks.db.membership.findMany.mockResolvedValue([
      {
        userId: "new-owner-user-id-cert",
        createdAt: new Date("2026-09-30T00:00:00.000Z"),
      },
    ]);
    agentOrganizationMocks.transferOrganizationOwnership.mockResolvedValue({
      id: "selected-account-cert",
      type: "ORGANIZATION",
      displayName: "Certification Org",
      ownerId: "new-owner-user-id-cert",
    });
  });

  let managementHandle = "";

  beforeEach(async () => {
    const {
      issueAgentOrganizationMemberManagementHandle,
    } = await import(
      "../apps/web/accounts/agent-organization-member-management"
    );
    managementHandle =
      issueAgentOrganizationMemberManagementHandle(
        "selected-account-cert",
        "new-owner-user-id-cert",
        new Date("2026-09-30T00:00:00.000Z"),
      );
  });

  function transferRequest(
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return new Request(
      "https://digital-solutions.example.test/api/agent-sessions/account/organization/ownership/transfer",
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

  it("projects ownership transfer as explicit Digital Solutions authority", () => {
    const overview = read(
      "apps/web/accounts/agent-organization-overview.ts",
    );
    const route = read(
      "app/api/agent-sessions/account/organization/route.ts",
    );
    expect(overview).toContain(
      "readonly transferOwnership: boolean;",
    );
    expect(overview).toContain(
      'account.lifecycleState === "ACTIVE"',
    );
    expect(route).toContain(
      "transfer_ownership:",
    );
    expect(route).toContain(
      "overview.permissions.transferOwnership",
    );
  });

  it("rejects browser-origin ownership transfer before Agent authentication", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/ownership/transfer/route"
    );
    const response = await POST(transferRequest({
      management_handle: managementHandle,
    }, {
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

  it("transfers to the selected-account scoped member handle without leaking identifiers", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/ownership/transfer/route"
    );
    const response = await POST(transferRequest({
      management_handle: managementHandle,
    }));

    expect(response.status).toBe(200);
    expect(
      agentOrganizationMocks.db.membership.findMany,
    ).toHaveBeenCalledWith({
      where: {
        accountId: "selected-account-cert",
      },
      select: {
        userId: true,
        createdAt: true,
      },
    });
    expect(
      agentOrganizationMocks.transferOrganizationOwnership,
    ).toHaveBeenCalledWith({
      actorId: "owner-user-cert",
      accountId: "selected-account-cert",
      newOwnerUserId: "new-owner-user-id-cert",
    });

    const payload = await response.json();
    expect(payload).toEqual({
      status: "transferred",
      reauthentication_required: true,
    });
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain("selected-account-cert");
    expect(wire).not.toContain("owner-user-cert");
    expect(wire).not.toContain("new-owner-user-id-cert");
    expect(
      response.headers.get("x-bke-account-session-version"),
    ).toBe("bke.account-session.v1");
  });

  it("rejects raw identifiers, malformed handles, stale handles, and cross-account handles", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/ownership/transfer/route"
    );

    for (const body of [
      {
        management_handle: managementHandle,
        account_id: "caller-selected-account",
      },
      {
        management_handle: managementHandle,
        user_id: "caller-selected-user",
      },
      {
        management_handle: managementHandle,
        membership_id: "caller-selected-membership",
      },
      {
        management_handle: managementHandle,
        owner_id: "caller-selected-owner",
      },
      {
        management_handle: "raw-user-or-membership-id",
      },
    ]) {
      const response = await POST(transferRequest(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "INVALID_INPUT",
      });
    }

    agentOrganizationMocks.db.membership.findMany.mockResolvedValueOnce(
      [],
    );
    const stale = await POST(transferRequest({
      management_handle: managementHandle,
    }));
    expect(stale.status).toBe(404);
    expect(await stale.json()).toEqual({
      error: "MEMBER_NOT_FOUND",
    });

    const {
      issueAgentOrganizationMemberManagementHandle,
    } = await import(
      "../apps/web/accounts/agent-organization-member-management"
    );
    const copiedFromAnotherAccount =
      issueAgentOrganizationMemberManagementHandle(
        "other-account-cert",
        "new-owner-user-id-cert",
        new Date("2026-09-30T00:00:00.000Z"),
      );
    const crossAccount = await POST(transferRequest({
      management_handle: copiedFromAnotherAccount,
    }));
    expect(crossAccount.status).toBe(404);
    expect(await crossAccount.json()).toEqual({
      error: "MEMBER_NOT_FOUND",
    });

    expect(
      agentOrganizationMocks.transferOrganizationOwnership,
    ).not.toHaveBeenCalled();
  });

  it("preserves Accounts authorization, lifecycle, and same-owner rejection semantics", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/ownership/transfer/route"
    );

    agentOrganizationMocks.transferOrganizationOwnership.mockRejectedValueOnce(
      new Error("ACCOUNT_ROLE_FORBIDDEN"),
    );
    const forbidden = await POST(transferRequest({
      management_handle: managementHandle,
    }));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error: "ACCOUNT_ROLE_FORBIDDEN",
    });

    agentOrganizationMocks.transferOrganizationOwnership.mockRejectedValueOnce(
      new Error("SUSPENDED_ACCOUNT"),
    );
    const suspended = await POST(transferRequest({
      management_handle: managementHandle,
    }));
    expect(suspended.status).toBe(409);
    expect(await suspended.json()).toEqual({
      error: "SUSPENDED_ACCOUNT",
    });

    agentOrganizationMocks.transferOrganizationOwnership.mockRejectedValueOnce(
      new Error("MEMBER_NOT_FOUND"),
    );
    const sameOwner = await POST(transferRequest({
      management_handle: managementHandle,
    }));
    expect(sameOwner.status).toBe(404);
    expect(await sameOwner.json()).toEqual({
      error: "MEMBER_NOT_FOUND",
    });
  });

  it("rate limits ownership transfer without invoking Accounts authority", async () => {
    agentOrganizationMocks.rateLimit.mockResolvedValueOnce({
      allowed: false,
    });
    const { POST } = await import(
      "../app/api/agent-sessions/account/organization/ownership/transfer/route"
    );
    const response = await POST(transferRequest({
      management_handle: managementHandle,
    }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "RATE_LIMITED",
    });
    expect(
      agentOrganizationMocks.transferOrganizationOwnership,
    ).not.toHaveBeenCalled();
  });
});

describe("native Agent account purchases overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentOrganizationMocks.getRuntimeEnvironment.mockReturnValue({
      AGENT_ACCOUNT_SESSION_ENABLED: true,
    });
    agentOrganizationMocks.authenticateNativeAgentRequest.mockResolvedValue({
      status: "authenticated",
      userId: "principal-purchases-cert",
      accountId: "selected-purchases-account-cert",
      sessionId: "agent-purchases-session-cert",
      deviceId: "agent-purchases-device-cert",
    });
    agentOrganizationMocks.rateLimit.mockResolvedValue({ allowed: true });
    agentOrganizationMocks.getAgentAccountPurchasesOverview.mockResolvedValue({
      status: "ready",
      account: {
        type: "ORGANIZATION",
        displayName: "Certification Organization",
        lifecycleState: "ACTIVE",
        role: "OWNER",
      },
      permissions: {
        viewOrders: true,
        viewSubscriptions: true,
        viewAllLicenses: true,
      },
      licenses: [{
        productName: "Render Dock",
        editionName: "Pro",
        planType: "ANNUAL",
        status: "ACTIVE",
        keyLastFour: "ABCD",
        expiresAt: new Date("2027-09-30T00:00:00.000Z"),
        maxDevices: 4,
        activeDevices: 1,
      }],
      subscriptions: [{
        productName: "Render Dock",
        editionName: "Pro",
        planType: "ANNUAL",
        status: "ACTIVE",
        seats: 2,
        currentPeriodEnd: new Date("2027-09-30T00:00:00.000Z"),
      }],
      orders: [{
        number: "ORD-CERT-001",
        status: "PAID",
        totalMinor: 30000000,
        currency: "PHP",
        createdAt: new Date("2026-09-30T00:00:00.000Z"),
        invoiceAvailable: true,
        items: [{
          productName: "Render Dock",
          editionName: "Pro",
          planName: "Annual",
        }],
      }],
    });
  });

  function purchasesRequest(
    headers: Record<string, string> = {},
  ) {
    return new Request(
      "https://digital-solutions.example.test/api/agent-sessions/account/purchases",
      {
        method: "GET",
        headers: {
          "x-bke-account-session-version":
            "bke.account-session.v1",
          ...headers,
        },
      },
    );
  }

  it("rejects browser-origin purchases reads before Agent authentication", async () => {
    const { GET } = await import(
      "../app/api/agent-sessions/account/purchases/route"
    );
    const response = await GET(purchasesRequest({
      origin: "https://browser.example.test",
    }));

    expect(response.status).toBe(403);
    expect(
      agentOrganizationMocks.authenticateNativeAgentRequest,
    ).not.toHaveBeenCalled();
    expect(
      response.headers.get("x-bke-account-session-version"),
    ).toBe("bke.account-session.v1");
  });

  it("binds purchases history to the authenticated principal and selected account without leaking authority identifiers", async () => {
    const { GET } = await import(
      "../app/api/agent-sessions/account/purchases/route"
    );
    const response = await GET(purchasesRequest());

    expect(response.status).toBe(200);
    expect(
      agentOrganizationMocks.getAgentAccountPurchasesOverview,
    ).toHaveBeenCalledWith({
      principalId: "principal-purchases-cert",
      accountId: "selected-purchases-account-cert",
    });

    const payload = await response.json();
    expect(payload.status).toBe("ready");
    expect(payload.licenses).toHaveLength(1);
    expect(payload.subscriptions).toHaveLength(1);
    expect(payload.orders).toHaveLength(1);

    const wire = JSON.stringify(payload).toLowerCase();
    for (const forbidden of [
      "selected-purchases-account-cert",
      "principal-purchases-cert",
      "agent-purchases-session-cert",
      "agent-purchases-device-cert",
      "access_token",
      "refresh_token",
      "checkout_url",
      "payment",
      "provider",
      "license_id",
      "order_id",
      "subscription_id",
      "invoice_id",
      "device_id",
      "license_key",
    ]) {
      expect(wire).not.toContain(forbidden);
    }
  });

  it("preserves purchases authorization denial, rate limiting, and fail-closed unavailable state", async () => {
    const { GET } = await import(
      "../app/api/agent-sessions/account/purchases/route"
    );

    agentOrganizationMocks.getAgentAccountPurchasesOverview.mockResolvedValueOnce({
      status: "forbidden",
    });
    const forbidden = await GET(purchasesRequest());
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error: "ACCOUNT_FORBIDDEN",
    });

    agentOrganizationMocks.rateLimit.mockResolvedValueOnce({
      allowed: false,
    });
    const limited = await GET(purchasesRequest());
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: "RATE_LIMITED",
    });

    agentOrganizationMocks.getAgentAccountPurchasesOverview.mockResolvedValueOnce({
      status: "failed",
    });
    const unavailable = await GET(purchasesRequest());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      error: "ACCOUNT_PURCHASES_UNAVAILABLE",
    });
  });
});


import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const agentOrganizationMocks = vi.hoisted(() => ({
  authenticateNativeAgentRequest: vi.fn(),
  createOrganizationAccount: vi.fn(),
  updateOrganizationProfile: vi.fn(),
  inviteOrganizationMember: vi.fn(),
  resendOrganizationInvitation: vi.fn(),
  revokeOrganizationInvitation: vi.fn(),
  expirePendingOrganizationInvitations: vi.fn(),
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
  resendOrganizationInvitation:
    agentOrganizationMocks.resendOrganizationInvitation,
  revokeOrganizationInvitation:
    agentOrganizationMocks.revokeOrganizationInvitation,
  expirePendingOrganizationInvitations:
    agentOrganizationMocks.expirePendingOrganizationInvitations,
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

import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireIdentityUser: vi.fn(),
  accountAccessAuthorize: vi.fn(),
  listSwitchableAccounts: vi.fn(),
  createOrganizationAccount: vi.fn(),
  listOrganizationInvitations: vi.fn(),
  expirePendingOrganizationInvitations: vi.fn(),
  inviteOrganizationMember: vi.fn(),
  resendOrganizationInvitation: vi.fn(),
  revokeOrganizationInvitation: vi.fn(),
  transferOrganizationOwnership: vi.fn(),
  checkLegalReacceptance: vi.fn(),
  getV2WebApplication: vi.fn(),
  db: { customerAccount: { findUniqueOrThrow: vi.fn() } },
}));

vi.mock("@/v2/apps/web/auth/session", () => ({ requireIdentityUser: mocks.requireIdentityUser }));
vi.mock("@/v2/apps/web/accounts/organization-operations", () => ({
  listSwitchableAccounts: mocks.listSwitchableAccounts,
  createOrganizationAccount: mocks.createOrganizationAccount,
  listOrganizationInvitations: mocks.listOrganizationInvitations,
  expirePendingOrganizationInvitations: mocks.expirePendingOrganizationInvitations,
  inviteOrganizationMember: mocks.inviteOrganizationMember,
  resendOrganizationInvitation: mocks.resendOrganizationInvitation,
  revokeOrganizationInvitation: mocks.revokeOrganizationInvitation,
  transferOrganizationOwnership: mocks.transferOrganizationOwnership,
}));
vi.mock("@/v2/apps/web/runtime", () => ({ getV2WebApplication: mocks.getV2WebApplication }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

const appUrl = process.env.APP_URL!;
const user = {
  id: "user-1",
  email: "owner@acme.test",
  name: "Owner",
  emailVerified: true,
  role: "CUSTOMER",
  establishedAt: new Date("2026-01-01T00:00:00.000Z"),
  suspendedAt: null,
  lifecycleState: "ACTIVE",
};
const params = { params: Promise.resolve({ id: "account-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireIdentityUser.mockResolvedValue(user);
  mocks.checkLegalReacceptance.mockResolvedValue({ status: "CURRENT" });
  mocks.accountAccessAuthorize.mockResolvedValue({
    status: "AUTHORIZED",
    account: {
      id: "account-1",
      type: "ORGANIZATION",
      displayName: "Acme",
      ownerId: user.id,
      billingEmail: "owner@acme.test",
      taxId: "tax",
      lifecycleState: "ACTIVE",
    },
    effectiveRole: "OWNER",
  });
  mocks.getV2WebApplication.mockResolvedValue({
    get: (capabilityId: string) =>
      capabilityId === "bke.accounts.account-access.v1"
        ? { authorize: mocks.accountAccessAuthorize }
        : { check: mocks.checkLegalReacceptance },
  });
  mocks.expirePendingOrganizationInvitations.mockResolvedValue({ count: 0 });
});

describe("organization API handlers", () => {
  it("rejects unauthenticated organization creation", async () => {
    mocks.requireIdentityUser.mockRejectedValue(new Error("UNAUTHENTICATED"));
    const { POST } = await import("../app/api/organizations/route");
    const response = await POST(
      new Request(`${appUrl}/api/organizations`, {
        method: "POST",
        headers: { origin: appUrl },
        body: "{}",
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.createOrganizationAccount).not.toHaveBeenCalled();
  });

  it("rejects hostile origins before organization mutation", async () => {
    const { POST } = await import("../app/api/organizations/route");
    const response = await POST(
      new Request(`${appUrl}/api/organizations`, {
        method: "POST",
        headers: { origin: "https://evil.test" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.requireIdentityUser).not.toHaveBeenCalled();
  });

  it("enforces email verification and Legal reacceptance clearance during creation", async () => {
    mocks.requireIdentityUser.mockResolvedValue({ ...user, emailVerified: false });
    const { POST } = await import("../app/api/organizations/route");
    const response = await POST(
      new Request(`${appUrl}/api/organizations`, {
        method: "POST",
        headers: { origin: appUrl },
        body: JSON.stringify({
          displayName: "Acme Org",
          legalName: "Acme Legal",
          billingEmail: "owner@acme.test",
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(mocks.checkLegalReacceptance).not.toHaveBeenCalled();

    mocks.requireIdentityUser.mockResolvedValue(user);
    mocks.checkLegalReacceptance.mockResolvedValue({ status: "REACCEPTANCE_REQUIRED", pending: [] });
    const blocked = await POST(
      new Request(`${appUrl}/api/organizations`, {
        method: "POST",
        headers: { origin: appUrl },
        body: JSON.stringify({
          displayName: "Acme Org",
          legalName: "Acme Legal",
          billingEmail: "owner@acme.test",
        }),
      }),
    );
    expect(blocked.status).toBe(409);
    expect(mocks.checkLegalReacceptance).toHaveBeenCalledWith({
      principalId: user.id,
      principalEstablishedAt: user.establishedAt,
    });
    expect(mocks.createOrganizationAccount).not.toHaveBeenCalled();
  });

  it("enforces Accounts invitation capability gating and never returns tokenHash", async () => {
    mocks.listOrganizationInvitations.mockRejectedValue(new Error("ACCOUNT_ROLE_FORBIDDEN"));
    const invitations = await import("../app/api/organizations/[id]/invitations/route");
    const denied = await invitations.GET(new Request("https://app.test/api/organizations/account-1"), params);
    expect(denied.status).toBe(403);
    expect(mocks.listOrganizationInvitations).toHaveBeenCalledWith(user.id, "account-1");

    mocks.listOrganizationInvitations.mockResolvedValue([
      {
        id: "inv-1",
        email: "member@acme.test",
        role: "MEMBER",
        status: "PENDING",
        expiresAt: new Date(),
        createdAt: new Date(),
      },
    ]);
    const allowed = await invitations.GET(new Request("https://app.test/api/organizations/account-1"), params);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual(
      expect.arrayContaining([expect.not.objectContaining({ tokenHash: expect.anything() })]),
    );
  });

  it("routes ownership transfer through the Accounts authority capability adapter", async () => {
    const cuid = "c123456789012345678901234";
    mocks.transferOrganizationOwnership.mockRejectedValue(new Error("ACCOUNT_ROLE_FORBIDDEN"));
    const { POST } = await import("../app/api/organizations/[id]/owner/route");
    const denied = await POST(
      new Request(`${appUrl}/api/organizations/account-1/owner`, {
        method: "POST",
        headers: { origin: appUrl, "content-type": "application/json" },
        body: JSON.stringify({ newOwnerUserId: cuid }),
      }),
      params,
    );
    expect(denied.status).toBe(403);
    expect(mocks.transferOrganizationOwnership).toHaveBeenCalledWith({
      actorId: user.id,
      accountId: "account-1",
      newOwnerUserId: cuid,
    });
  });

  it("serializes the retained rich account-detail read model through an explicit safe invitation select", async () => {
    mocks.db.customerAccount.findUniqueOrThrow.mockResolvedValue({
      id: "account-1",
      type: "ORGANIZATION",
      displayName: "Acme",
      lifecycleState: "ACTIVE",
      organization: { legalName: "Acme" },
      billingEmail: "owner@acme.test",
      taxId: "tax",
      memberships: [],
      invitations: [
        {
          id: "inv-1",
          email: "member@acme.test",
          role: "MEMBER",
          status: "PENDING",
          expiresAt: new Date(),
          createdAt: new Date(),
        },
      ],
      _count: { licenses: 0, subscriptions: 0, orders: 0 },
    });
    const { GET } = await import("../app/api/organizations/[id]/route");
    const response = await GET(new Request("https://app.test/api/organizations/account-1"), params);
    expect(response.status).toBe(200);
    expect(mocks.accountAccessAuthorize).toHaveBeenCalledWith({
      principalId: user.id,
      accountId: "account-1",
    });
    expect((await response.json()).invitations[0]).not.toHaveProperty("tokenHash");
    expect(mocks.db.customerAccount.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          invitations: expect.objectContaining({
            select: expect.objectContaining({ id: true, email: true, createdAt: true }),
          }),
        }),
      }),
    );
  });
});

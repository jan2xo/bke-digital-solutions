import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAccountAccess: vi.fn(),
  requireAccountCapability: vi.fn(),
  listSwitchableAccounts: vi.fn(),
  createOrganizationAccount: vi.fn(),
  assertLegalAcceptanceCurrent: vi.fn(),
  db: { customerAccount: { findUniqueOrThrow: vi.fn() }, invitation: { findMany: vi.fn() } },
  expirePendingOrganizationInvitations: vi.fn(),
  inviteOrganizationMember: vi.fn(),
  resendOrganizationInvitation: vi.fn(),
  revokeOrganizationInvitation: vi.fn(),
  transferOrganizationOwnership: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/authorization", () => ({
  requireAccountAccess: mocks.requireAccountAccess,
  requireAccountCapability: mocks.requireAccountCapability,
  roleHasCapability: (role: string, capability: string) => role === "OWNER" || (role === "BILLING" && ["VIEW_PAYMENTS", "MANAGE_MEMBERS"].includes(capability)),
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/organizations", () => ({
  listSwitchableAccounts: mocks.listSwitchableAccounts,
  createOrganizationAccount: mocks.createOrganizationAccount,
  expirePendingOrganizationInvitations: mocks.expirePendingOrganizationInvitations,
  inviteOrganizationMember: mocks.inviteOrganizationMember,
  resendOrganizationInvitation: mocks.resendOrganizationInvitation,
  revokeOrganizationInvitation: mocks.revokeOrganizationInvitation,
  transferOrganizationOwnership: mocks.transferOrganizationOwnership,
}));
vi.mock("@/lib/legal/service", () => ({ assertLegalAcceptanceCurrent: mocks.assertLegalAcceptanceCurrent }));

const appUrl = process.env.APP_URL!;
const user = { id: "user-1", emailVerified: new Date() };
const params = { params: Promise.resolve({ id: "account-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(user);
  mocks.assertLegalAcceptanceCurrent.mockResolvedValue(undefined);
  mocks.expirePendingOrganizationInvitations.mockResolvedValue({ count: 0 });
});

describe("organization API handlers", () => {
  it("rejects unauthenticated organization creation", async () => {
    mocks.requireUser.mockRejectedValue(new Error("UNAUTHENTICATED"));
    const { POST } = await import("../app/api/organizations/route");
    const response = await POST(new Request(`${appUrl}/api/organizations`, { method: "POST", headers: { origin: appUrl }, body: "{}" }));
    expect(response.status).toBe(401);
    expect(mocks.createOrganizationAccount).not.toHaveBeenCalled();
  });

  it("rejects hostile origins before organization mutation", async () => {
    const { POST } = await import("../app/api/organizations/route");
    const response = await POST(new Request(`${appUrl}/api/organizations`, { method: "POST", headers: { origin: "https://evil.test" }, body: "{}" }));
    expect(response.status).toBe(403);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("enforces email verification and legal clearance during creation", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user-1", emailVerified: null });
    const { POST } = await import("../app/api/organizations/route");
    const response = await POST(new Request(`${appUrl}/api/organizations`, { method: "POST", headers: { origin: appUrl }, body: JSON.stringify({ displayName: "Acme Org", legalName: "Acme Legal", billingEmail: "owner@acme.test" }) }));
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(mocks.assertLegalAcceptanceCurrent).not.toHaveBeenCalled();

    mocks.requireUser.mockResolvedValue(user);
    mocks.assertLegalAcceptanceCurrent.mockRejectedValue(new Error("LEGAL_REACCEPTANCE_REQUIRED"));
    const blocked = await POST(new Request(`${appUrl}/api/organizations`, { method: "POST", headers: { origin: appUrl }, body: JSON.stringify({ displayName: "Acme Org", legalName: "Acme Legal", billingEmail: "owner@acme.test" }) }));
    expect(blocked.status).toBe(409);
    expect(mocks.createOrganizationAccount).not.toHaveBeenCalled();
  });

  it("enforces capability gating and returns invitation data without tokenHash", async () => {
    mocks.requireAccountCapability.mockRejectedValue(new Error("ACCOUNT_ROLE_FORBIDDEN"));
    const invitations = await import("../app/api/organizations/[id]/invitations/route");
    const denied = await invitations.GET(new Request("https://app.test/api/organizations/account-1"), params);
    expect(denied.status).toBe(403);
    expect(mocks.db.invitation.findMany).not.toHaveBeenCalled();

    mocks.requireAccountCapability.mockResolvedValue({ effectiveRole: "OWNER" });
    mocks.db.invitation.findMany.mockResolvedValue([{ id: "inv-1", email: "member@acme.test", role: "MEMBER", status: "PENDING", expiresAt: new Date(), createdAt: new Date() }]);
    const allowed = await invitations.GET(new Request("https://app.test/api/organizations/account-1"), params);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual(expect.arrayContaining([expect.not.objectContaining({ tokenHash: expect.anything() })]));
  });

  it("routes ownership transfer through the authority-enforcing service", async () => {
    const cuid = "c123456789012345678901234";
    mocks.transferOrganizationOwnership.mockRejectedValue(new Error("ACCOUNT_ROLE_FORBIDDEN"));
    const { POST } = await import("../app/api/organizations/[id]/owner/route");
    const denied = await POST(new Request(`${appUrl}/api/organizations/account-1/owner`, { method: "POST", headers: { origin: appUrl, "content-type": "application/json" }, body: JSON.stringify({ newOwnerUserId: cuid }) }), params);
    expect(denied.status).toBe(403);
    expect(mocks.transferOrganizationOwnership).toHaveBeenCalledWith({ actorId: user.id, accountId: "account-1", newOwnerUserId: cuid });
  });

  it("serializes account-detail invitations through an explicit safe select", async () => {
    mocks.requireAccountAccess.mockResolvedValue({ effectiveRole: "OWNER" });
    mocks.db.customerAccount.findUniqueOrThrow.mockResolvedValue({ id: "account-1", type: "ORGANIZATION", displayName: "Acme", lifecycleState: "ACTIVE", organization: { legalName: "Acme" }, billingEmail: "owner@acme.test", taxId: "tax", memberships: [], invitations: [{ id: "inv-1", email: "member@acme.test", role: "MEMBER", status: "PENDING", expiresAt: new Date(), createdAt: new Date() }], _count: { licenses: 0, subscriptions: 0, orders: 0 } });
    const { GET } = await import("../app/api/organizations/[id]/route");
    const response = await GET(new Request("https://app.test/api/organizations/account-1"), params);
    expect(response.status).toBe(200);
    expect((await response.json()).invitations[0]).not.toHaveProperty("tokenHash");
    expect(mocks.db.customerAccount.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ invitations: expect.objectContaining({ select: expect.objectContaining({ id: true, email: true, createdAt: true }) }) }) }));
  });
});

import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
let ownerId = "";
let memberId = "";
let billingId = "";
let outsiderId = "";
let accountId = "";
let fixturesReady: boolean | undefined;

async function makeUser(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return db.user.create({ data: { email: `${label}-${suffix}@bke.test`, name: label, emailVerified: new Date() } });
}

async function ensureFixtures() {
  if (fixturesReady !== undefined) return fixturesReady;
  try {
    const owner = await makeUser("org-owner");
    const member = await makeUser("org-member");
    const billing = await makeUser("org-billing");
    const outsider = await makeUser("org-outsider");
    ownerId = owner.id;
    memberId = member.id;
    billingId = billing.id;
    outsiderId = outsider.id;
    const account = await db.customerAccount.create({
      data: {
        type: "ORGANIZATION",
        displayName: "Integration Org",
        ownerId,
        billingEmail: owner.email,
        organization: { create: { legalName: "Integration Org LLC" } },
        memberships: { create: [{ userId: ownerId, role: "OWNER" }, { userId: billingId, role: "BILLING" }] },
      },
    });
    accountId = account.id;
    fixturesReady = true;
  } catch (error) {
    if (String(error).includes("Can't reach database server")) {
      console.warn("Skipping database-backed organization assertions because DATABASE_URL is unreachable.");
      fixturesReady = false;
    } else {
      throw error;
    }
  }
  return fixturesReady;
}

describe.sequential("organization integration controls", () => {
  afterAll(async () => { await db.$disconnect(); });

  it("accepts an invitation only once under concurrent replay and audits one membership", async () => {
    if (!(await ensureFixtures())) return;
    const { inviteOrganizationMember, acceptOrganizationInvitation } = await import("@/lib/organizations");
    const invited = await db.user.findUniqueOrThrow({ where: { id: memberId } });
    const { token, invitation } = await inviteOrganizationMember({ actorId: ownerId, accountId, email: invited.email, role: "LICENSE_MANAGER" });
    const results = await Promise.allSettled([
      acceptOrganizationInvitation({ userId: memberId, email: invited.email, token }),
      acceptOrganizationInvitation({ userId: memberId, email: invited.email, token }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("ACCEPTED");
    expect(await db.membership.count({ where: { accountId, userId: memberId } })).toBe(1);
    expect(await db.auditLog.count({ where: { accountId, action: "ORGANIZATION_INVITATION_ACCEPTED", targetId: memberId } })).toBe(1);
  });

  it("blocks invitation acceptance when the organization is suspended without consuming the token", async () => {
    if (!(await ensureFixtures())) return;
    const { inviteOrganizationMember, acceptOrganizationInvitation } = await import("@/lib/organizations");
    const target = await makeUser("suspended-invitee");
    const { token, invitation } = await inviteOrganizationMember({ actorId: ownerId, accountId, email: target.email, role: "MEMBER" });
    await db.customerAccount.update({ where: { id: accountId }, data: { lifecycleState: "SUSPENDED" } });
    await expect(acceptOrganizationInvitation({ userId: target.id, email: target.email, token })).rejects.toThrow("SUSPENDED_ACCOUNT");
    expect((await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe("PENDING");
    await db.customerAccount.update({ where: { id: accountId }, data: { lifecycleState: "ACTIVE" } });
  });

  it("requires accepted membership for owner transfer and records coherent handoff metadata", async () => {
    if (!(await ensureFixtures())) return;
    const { transferOrganizationOwnership } = await import("@/lib/organizations");
    await expect(transferOrganizationOwnership({ actorId: ownerId, accountId, newOwnerUserId: outsiderId })).rejects.toThrow("MEMBER_NOT_FOUND");
    await transferOrganizationOwnership({ actorId: ownerId, accountId, newOwnerUserId: memberId });
    expect((await db.customerAccount.findUniqueOrThrow({ where: { id: accountId } })).ownerId).toBe(memberId);
    const audit = await db.auditLog.findFirstOrThrow({ where: { accountId, action: "ORGANIZATION_OWNER_TRANSFERRED" }, orderBy: { createdAt: "desc" } });
    expect(audit.metadata).toMatchObject({ from: ownerId, to: memberId, previousRole: "LICENSE_MANAGER", nextRole: "OWNER" });
  });

  it("keeps billing/tax edits separate from organization administration and excludes suspended switching", async () => {
    if (!(await ensureFixtures())) return;
    const { updateOrganizationProfile, listSwitchableAccounts } = await import("@/lib/organizations");
    await updateOrganizationProfile({ actorId: billingId, accountId, billingEmail: "billing-updated@bke.test", taxId: "TIN-123" });
    await expect(updateOrganizationProfile({ actorId: billingId, accountId, displayName: "Forbidden rename" })).rejects.toThrow("ACCOUNT_ROLE_FORBIDDEN");
    await db.customerAccount.update({ where: { id: accountId }, data: { lifecycleState: "SUSPENDED" } });
    expect((await listSwitchableAccounts(billingId)).some((account) => account.id === accountId)).toBe(false);
  });
});

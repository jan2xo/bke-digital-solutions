import "dotenv/config";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import {
  acceptOrganizationInvitation,
  closeOrganization,
  createOrganizationAccount,
  expirePendingOrganizationInvitations,
  getOrganizationAuditHistory,
  inviteOrganizationMember,
  leaveOrganization,
  listSwitchableAccounts,
  removeOrganizationMember,
  resendOrganizationInvitation,
  revokeOrganizationInvitation,
  suspendOrganization,
  transferOrganizationOwnership,
  updateOrganizationMemberRole,
  updateOrganizationProfile,
} from "@/lib/organizations";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
beforeAll(async () => {
  await db.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await db.$disconnect();
});

async function user(email: string) {
  return db.user.create({ data: { email, emailVerified: new Date() } });
}

describe("Phase 6.9 private DB organization acceptance", () => {
  it("covers invitation lifecycle, acceptance isolation, role changes, ownership, self-exit, and audit history", async () => {
    const suffix = Date.now().toString(36);
    const owner = await user(`phase69-db-owner-${suffix}@bke.test`);
    const billing = await user(`phase69-db-billing-${suffix}@bke.test`);
    const manager = await user(`phase69-db-manager-${suffix}@bke.test`);
    const outsider = await user(`phase69-db-outsider-${suffix}@bke.test`);

    const account = await createOrganizationAccount({ actorId: owner.id, displayName: `Phase 6.9 DB ${suffix}`, legalName: `Phase 6.9 Legal ${suffix}`, billingEmail: owner.email });
    await expect(updateOrganizationProfile({ actorId: outsider.id, accountId: account.id, displayName: "nope" })).rejects.toThrow("NOT_FOUND");

    const billingInvite = await inviteOrganizationMember({ actorId: owner.id, accountId: account.id, email: billing.email, role: "BILLING" });
    await expect(acceptOrganizationInvitation({ userId: outsider.id, email: outsider.email, token: billingInvite.token })).rejects.toThrow("INVITATION_EMAIL_MISMATCH");
    await acceptOrganizationInvitation({ userId: billing.id, email: billing.email.toUpperCase(), token: billingInvite.token });
    await expect(acceptOrganizationInvitation({ userId: billing.id, email: billing.email, token: billingInvite.token })).rejects.toThrow("INVITATION_NOT_PENDING");

    const managerInvite = await inviteOrganizationMember({ actorId: owner.id, accountId: account.id, email: manager.email, role: "LICENSE_MANAGER" });
    const resent = await resendOrganizationInvitation({ actorId: owner.id, invitationId: managerInvite.invitation.id });
    await acceptOrganizationInvitation({ userId: manager.id, email: manager.email, token: resent.token });

    const revoked = await inviteOrganizationMember({ actorId: owner.id, accountId: account.id, email: `phase69-revoked-${suffix}@bke.test`, role: "MEMBER" });
    await revokeOrganizationInvitation({ actorId: owner.id, invitationId: revoked.invitation.id });
    await expect(acceptOrganizationInvitation({ userId: outsider.id, email: revoked.invitation.email, token: revoked.token })).rejects.toThrow("INVITATION_NOT_PENDING");

    await inviteOrganizationMember({ actorId: owner.id, accountId: account.id, email: `phase69-expired-${suffix}@bke.test`, role: "MEMBER", expiresAt: new Date(Date.now() - 1_000) });
    await expect(expirePendingOrganizationInvitations(new Date())).resolves.toMatchObject({ count: expect.any(Number) });

    await expect(updateOrganizationMemberRole({ actorId: billing.id, accountId: account.id, userId: manager.id, role: "OWNER" })).rejects.toThrow("ACCOUNT_ROLE_FORBIDDEN");
    await updateOrganizationMemberRole({ actorId: owner.id, accountId: account.id, userId: manager.id, role: "OWNER" });
    await transferOrganizationOwnership({ actorId: owner.id, accountId: account.id, newOwnerUserId: manager.id });
    await removeOrganizationMember({ actorId: manager.id, accountId: account.id, userId: billing.id });
    await expect(leaveOrganization({ actorId: manager.id, accountId: account.id })).rejects.toThrow("OWNER_CANNOT_LEAVE");

    const switchable = await listSwitchableAccounts(manager.id);
    expect(switchable.map((entry) => entry.id)).toContain(account.id);
    const audit = await getOrganizationAuditHistory({ actorId: manager.id, accountId: account.id });
    expect(audit.map((entry) => entry.action)).toEqual(expect.arrayContaining([
      "ORGANIZATION_CREATED",
      "ORGANIZATION_INVITATION_CREATED",
      "ORGANIZATION_INVITATION_RESENT",
      "ORGANIZATION_INVITATION_REVOKED",
      "ORGANIZATION_INVITATION_ACCEPTED",
      "ORGANIZATION_MEMBER_ROLE_UPDATED",
      "ORGANIZATION_OWNER_TRANSFERRED",
      "ORGANIZATION_MEMBER_REMOVED",
    ]));
  });

  it("enforces suspended and closed organization mutation boundaries", async () => {
    const suffix = `${Date.now().toString(36)}-lifecycle`;
    const owner = await user(`phase69-db-owner-${suffix}@bke.test`);
    const account = await createOrganizationAccount({ actorId: owner.id, displayName: `Phase 6.9 Lifecycle ${suffix}`, legalName: `Phase 6.9 Lifecycle Legal ${suffix}`, billingEmail: owner.email });

    await suspendOrganization({ actorId: owner.id, accountId: account.id, reason: "acceptance coverage" });
    await expect(inviteOrganizationMember({ actorId: owner.id, accountId: account.id, email: `phase69-suspended-${suffix}@bke.test`, role: "MEMBER" })).rejects.toThrow("SUSPENDED_ACCOUNT");

    const closedOwner = await user(`phase69-db-closed-owner-${suffix}@bke.test`);
    const closed = await createOrganizationAccount({ actorId: closedOwner.id, displayName: `Phase 6.9 Closed ${suffix}`, legalName: `Phase 6.9 Closed Legal ${suffix}`, billingEmail: closedOwner.email });
    await closeOrganization({ actorId: closedOwner.id, accountId: closed.id });
    await expect(updateOrganizationProfile({ actorId: closedOwner.id, accountId: closed.id, displayName: "closed mutation" })).rejects.toThrow("CLOSED_ACCOUNT");
    await expect(listSwitchableAccounts(closedOwner.id)).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: closed.id })]));
  });
});

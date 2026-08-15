import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { AccountAuthorizationError, assertLastOwnerPreserved, requireAccountCapability, requireAccountAccess, type AccountRole } from "@/lib/authorization";

export class OrganizationError extends Error {
  constructor(public readonly code: "ACCOUNT_NOT_ORGANIZATION" | "INVITATION_NOT_FOUND" | "INVITATION_NOT_PENDING" | "INVITATION_EXPIRED" | "INVITATION_EMAIL_MISMATCH" | "OWNER_CANNOT_LEAVE" | "CLOSED_ACCOUNT" | "SUSPENDED_ACCOUNT" | "LAST_OWNER_REQUIRED") { super(code); }
}

type Tx = typeof db;
type Role = AccountRole;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

async function audit(tx: Tx, input: { actorId?: string; accountId: string; action: string; targetType: string; targetId?: string; metadata?: object }) {
  await tx.auditLog.create({ data: { actorId: input.actorId, accountId: input.accountId, action: input.action, targetType: input.targetType, targetId: input.targetId, metadata: input.metadata ?? {} } });
}

async function requireMutableOrganization(userId: string, accountId: string) {
  const account = await requireAccountCapability(userId, accountId, "MANAGE_MEMBERS");
  if (account.type !== "ORGANIZATION") throw new OrganizationError("ACCOUNT_NOT_ORGANIZATION");
  if (account.lifecycleState === "CLOSED" || account.lifecycleState === "CLOSURE_REQUESTED") throw new OrganizationError("CLOSED_ACCOUNT");
  if (account.lifecycleState === "SUSPENDED") throw new OrganizationError("SUSPENDED_ACCOUNT");
  return account;
}

export async function listSwitchableAccounts(userId: string) {
  return db.customerAccount.findMany({
    where: { lifecycleState: { not: "CLOSED" }, OR: [{ ownerId: userId }, { memberships: { some: { userId } } }] },
    include: { organization: true, memberships: { where: { userId }, take: 1 } },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
  });
}

export async function createOrganizationAccount(input: { actorId: string; displayName: string; legalName: string; billingEmail: string; registrationNumber?: string; taxId?: string }) {
  return db.$transaction(async (tx) => {
    const account = await tx.customerAccount.create({
      data: { type: "ORGANIZATION", displayName: input.displayName, ownerId: input.actorId, billingEmail: input.billingEmail, taxId: input.taxId, organization: { create: { legalName: input.legalName, registrationNumber: input.registrationNumber } }, memberships: { create: { userId: input.actorId, role: "OWNER" } } },
      include: { organization: true, memberships: true },
    });
    await audit(tx as Tx, { actorId: input.actorId, accountId: account.id, action: "ORGANIZATION_CREATED", targetType: "CustomerAccount", targetId: account.id });
    return account;
  });
}

export async function updateOrganizationProfile(input: { actorId: string; accountId: string; displayName?: string; legalName?: string; billingEmail?: string; registrationNumber?: string | null; taxId?: string | null }) {
  await requireMutableOrganization(input.actorId, input.accountId);
  return db.$transaction(async (tx) => {
    const account = await tx.customerAccount.update({ where: { id: input.accountId }, data: { displayName: input.displayName, billingEmail: input.billingEmail, taxId: input.taxId, organization: { update: { legalName: input.legalName, registrationNumber: input.registrationNumber } } }, include: { organization: true } });
    await audit(tx as Tx, { actorId: input.actorId, accountId: input.accountId, action: "ORGANIZATION_PROFILE_UPDATED", targetType: "CustomerAccount", targetId: input.accountId });
    return account;
  });
}

export async function inviteOrganizationMember(input: { actorId: string; accountId: string; email: string; role: Role; expiresAt?: Date }) {
  await requireMutableOrganization(input.actorId, input.accountId);
  const token = randomBytes(32).toString("base64url");
  const invitation = await db.invitation.create({ data: { accountId: input.accountId, email: input.email.toLowerCase(), role: input.role, tokenHash: tokenHash(token), expiresAt: input.expiresAt ?? daysFromNow(7) } });
  await audit(db, { actorId: input.actorId, accountId: input.accountId, action: "ORGANIZATION_INVITATION_CREATED", targetType: "Invitation", targetId: invitation.id, metadata: { role: input.role } });
  return { invitation, token };
}

export async function resendOrganizationInvitation(input: { actorId: string; invitationId: string; expiresAt?: Date }) {
  const existing = await db.invitation.findUnique({ where: { id: input.invitationId } });
  if (!existing) throw new OrganizationError("INVITATION_NOT_FOUND");
  await requireMutableOrganization(input.actorId, existing.accountId);
  if (existing.status !== "PENDING") throw new OrganizationError("INVITATION_NOT_PENDING");
  const token = randomBytes(32).toString("base64url");
  const invitation = await db.invitation.update({ where: { id: existing.id }, data: { tokenHash: tokenHash(token), expiresAt: input.expiresAt ?? daysFromNow(7) } });
  await audit(db, { actorId: input.actorId, accountId: existing.accountId, action: "ORGANIZATION_INVITATION_RESENT", targetType: "Invitation", targetId: existing.id });
  return { invitation, token };
}

export async function revokeOrganizationInvitation(input: { actorId: string; invitationId: string }) {
  const existing = await db.invitation.findUnique({ where: { id: input.invitationId } });
  if (!existing) throw new OrganizationError("INVITATION_NOT_FOUND");
  await requireMutableOrganization(input.actorId, existing.accountId);
  const invitation = await db.invitation.update({ where: { id: existing.id }, data: { status: "REVOKED" } });
  await audit(db, { actorId: input.actorId, accountId: existing.accountId, action: "ORGANIZATION_INVITATION_REVOKED", targetType: "Invitation", targetId: existing.id });
  return invitation;
}

export async function expirePendingOrganizationInvitations(now = new Date()) {
  return db.invitation.updateMany({ where: { status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
}

export async function acceptOrganizationInvitation(input: { userId: string; email: string; token: string }) {
  const invitation = await db.invitation.findUnique({ where: { tokenHash: tokenHash(input.token) } });
  if (!invitation) throw new OrganizationError("INVITATION_NOT_FOUND");
  if (invitation.status !== "PENDING") throw new OrganizationError("INVITATION_NOT_PENDING");
  if (invitation.expiresAt <= new Date()) throw new OrganizationError("INVITATION_EXPIRED");
  if (invitation.email !== input.email.toLowerCase()) throw new OrganizationError("INVITATION_EMAIL_MISMATCH");
  return db.$transaction(async (tx) => {
    await tx.invitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED" } });
    const membership = await tx.membership.upsert({ where: { accountId_userId: { accountId: invitation.accountId, userId: input.userId } }, update: { role: invitation.role }, create: { accountId: invitation.accountId, userId: input.userId, role: invitation.role } });
    await audit(tx as Tx, { actorId: input.userId, accountId: invitation.accountId, action: "ORGANIZATION_INVITATION_ACCEPTED", targetType: "Membership", targetId: input.userId, metadata: { invitationId: invitation.id, role: invitation.role } });
    return membership;
  });
}

export async function updateOrganizationMemberRole(input: { actorId: string; accountId: string; userId: string; role: Role }) {
  await requireMutableOrganization(input.actorId, input.accountId);
  const [member, ownerCount] = await Promise.all([db.membership.findUniqueOrThrow({ where: { accountId_userId: { accountId: input.accountId, userId: input.userId } } }), db.membership.count({ where: { accountId: input.accountId, role: "OWNER" } })]);
  assertLastOwnerPreserved({ currentRole: member.role as Role, nextRole: input.role, ownerCount });
  const updated = await db.membership.update({ where: { accountId_userId: { accountId: input.accountId, userId: input.userId } }, data: { role: input.role } });
  await audit(db, { actorId: input.actorId, accountId: input.accountId, action: "ORGANIZATION_MEMBER_ROLE_UPDATED", targetType: "Membership", targetId: input.userId, metadata: { from: member.role, to: input.role } });
  return updated;
}

export async function transferOrganizationOwnership(input: { actorId: string; accountId: string; newOwnerUserId: string }) {
  await requireMutableOrganization(input.actorId, input.accountId);
  return db.$transaction(async (tx) => {
    await tx.membership.upsert({ where: { accountId_userId: { accountId: input.accountId, userId: input.newOwnerUserId } }, update: { role: "OWNER" }, create: { accountId: input.accountId, userId: input.newOwnerUserId, role: "OWNER" } });
    const account = await tx.customerAccount.update({ where: { id: input.accountId }, data: { ownerId: input.newOwnerUserId } });
    await audit(tx as Tx, { actorId: input.actorId, accountId: input.accountId, action: "ORGANIZATION_OWNER_TRANSFERRED", targetType: "CustomerAccount", targetId: input.accountId, metadata: { to: input.newOwnerUserId } });
    return account;
  });
}

export async function removeOrganizationMember(input: { actorId: string; accountId: string; userId: string }) {
  await requireMutableOrganization(input.actorId, input.accountId);
  const [member, ownerCount] = await Promise.all([db.membership.findUniqueOrThrow({ where: { accountId_userId: { accountId: input.accountId, userId: input.userId } } }), db.membership.count({ where: { accountId: input.accountId, role: "OWNER" } })]);
  assertLastOwnerPreserved({ currentRole: member.role as Role, ownerCount });
  const removed = await db.membership.delete({ where: { accountId_userId: { accountId: input.accountId, userId: input.userId } } });
  await audit(db, { actorId: input.actorId, accountId: input.accountId, action: "ORGANIZATION_MEMBER_REMOVED", targetType: "Membership", targetId: input.userId });
  return removed;
}

export async function leaveOrganization(input: { actorId: string; accountId: string }) {
  const member = await requireAccountAccess(input.actorId, input.accountId);
  if (member.effectiveRole === "OWNER") throw new OrganizationError("OWNER_CANNOT_LEAVE");
  await db.membership.delete({ where: { accountId_userId: { accountId: input.accountId, userId: input.actorId } } });
  await audit(db, { actorId: input.actorId, accountId: input.accountId, action: "ORGANIZATION_MEMBER_LEFT", targetType: "Membership", targetId: input.actorId });
}

export async function suspendOrganization(input: { actorId: string; accountId: string; reason?: string }) {
  await requireAccountCapability(input.actorId, input.accountId, "CLOSE_ACCOUNT");
  const account = await db.customerAccount.update({ where: { id: input.accountId, type: "ORGANIZATION" }, data: { lifecycleState: "SUSPENDED", legalHoldReason: input.reason } });
  await audit(db, { actorId: input.actorId, accountId: input.accountId, action: "ORGANIZATION_SUSPENDED", targetType: "CustomerAccount", targetId: input.accountId, metadata: { reason: input.reason } });
  return account;
}

export async function closeOrganization(input: { actorId: string; accountId: string }) {
  await requireAccountCapability(input.actorId, input.accountId, "CLOSE_ACCOUNT");
  const now = new Date();
  const account = await db.customerAccount.update({ where: { id: input.accountId, type: "ORGANIZATION" }, data: { lifecycleState: "CLOSED", closureRequestedAt: now, closedAt: now } });
  await audit(db, { actorId: input.actorId, accountId: input.accountId, action: "ORGANIZATION_CLOSED", targetType: "CustomerAccount", targetId: input.accountId });
  return account;
}

export async function getOrganizationAuditHistory(input: { actorId: string; accountId: string }) {
  await requireAccountCapability(input.actorId, input.accountId, "MANAGE_MEMBERS");
  return db.auditLog.findMany({ where: { accountId: input.accountId }, orderBy: { createdAt: "desc" } });
}

export { AccountAuthorizationError };

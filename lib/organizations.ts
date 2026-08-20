import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { AccountAuthorizationError, assertLastOwnerPreserved, requireAccountCapability, requireAccountAccess, type AccountRole, type AccountCapability } from "@/lib/authorization";

export class OrganizationError extends Error {
  constructor(public readonly code: "ACCOUNT_NOT_ORGANIZATION" | "INVITATION_NOT_FOUND" | "INVITATION_NOT_PENDING" | "INVITATION_EXPIRED" | "INVITATION_EMAIL_MISMATCH" | "OWNER_CANNOT_LEAVE" | "CLOSED_ACCOUNT" | "SUSPENDED_ACCOUNT" | "LAST_OWNER_REQUIRED" | "MEMBER_NOT_FOUND") { super(code); }
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

async function requireOrganizationCapability(userId: string, accountId: string, capability: AccountCapability) {
  const account = await requireAccountCapability(userId, accountId, capability);
  if (account.type !== "ORGANIZATION") throw new OrganizationError("ACCOUNT_NOT_ORGANIZATION");
  if (account.lifecycleState === "CLOSED" || account.lifecycleState === "CLOSURE_REQUESTED") throw new OrganizationError("CLOSED_ACCOUNT");
  if (account.lifecycleState === "SUSPENDED") throw new OrganizationError("SUSPENDED_ACCOUNT");
  return account;
}

export async function listSwitchableAccounts(userId: string) {
  return db.customerAccount.findMany({
    where: { lifecycleState: "ACTIVE", OR: [{ ownerId: userId }, { memberships: { some: { userId } } }] },
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
  const organizationFieldsChanged = input.displayName !== undefined || input.legalName !== undefined || input.registrationNumber !== undefined;
  const billingFieldsChanged = input.billingEmail !== undefined || input.taxId !== undefined;
  if (organizationFieldsChanged) await requireOrganizationCapability(input.actorId, input.accountId, "MANAGE_MEMBERS");
  if (billingFieldsChanged) await requireOrganizationCapability(input.actorId, input.accountId, "VIEW_PAYMENTS");
  if (!organizationFieldsChanged && !billingFieldsChanged) await requireMutableOrganization(input.actorId, input.accountId);
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
  if (existing.status !== "PENDING") throw new OrganizationError("INVITATION_NOT_PENDING");
  const claimed = await db.invitation.updateMany({ where: { id: existing.id, status: "PENDING" }, data: { status: "REVOKED" } });
  if (claimed.count !== 1) throw new OrganizationError("INVITATION_NOT_PENDING");
  const invitation = await db.invitation.findUniqueOrThrow({ where: { id: existing.id } });
  await audit(db, { actorId: input.actorId, accountId: existing.accountId, action: "ORGANIZATION_INVITATION_REVOKED", targetType: "Invitation", targetId: existing.id });
  return invitation;
}

export async function expirePendingOrganizationInvitations(now = new Date()) {
  return db.$transaction(async (tx) => {
    const expired = await tx.invitation.findMany({ where: { status: "PENDING", expiresAt: { lte: now } }, select: { id: true, accountId: true } });
    let count = 0;
    for (const invitation of expired) {
      const result = await tx.invitation.updateMany({ where: { id: invitation.id, status: "PENDING" }, data: { status: "EXPIRED" } });
      if (result.count === 1) {
        count += 1;
        await audit(tx as Tx, { accountId: invitation.accountId, action: "ORGANIZATION_INVITATION_EXPIRED", targetType: "Invitation", targetId: invitation.id });
      }
    }
    return { count };
  });
}

export async function acceptOrganizationInvitation(input: { userId: string; email: string; token: string }) {
  const hashedToken = tokenHash(input.token);
  const email = input.email.toLowerCase();
  const now = new Date();
  return db.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({ where: { tokenHash: hashedToken, status: "PENDING", expiresAt: { gt: now }, email }, data: { status: "ACCEPTED" } });
    if (claimed.count !== 1) {
      const existing = await tx.invitation.findUnique({ where: { tokenHash: hashedToken } });
      if (!existing) throw new OrganizationError("INVITATION_NOT_FOUND");
      if (existing.status !== "PENDING") throw new OrganizationError("INVITATION_NOT_PENDING");
      if (existing.expiresAt <= now) throw new OrganizationError("INVITATION_EXPIRED");
      if (existing.email !== email) throw new OrganizationError("INVITATION_EMAIL_MISMATCH");
      throw new OrganizationError("INVITATION_NOT_PENDING");
    }
    const invitation = await tx.invitation.findUniqueOrThrow({ where: { tokenHash: hashedToken }, include: { account: true } });
    if (invitation.account.type !== "ORGANIZATION") throw new OrganizationError("ACCOUNT_NOT_ORGANIZATION");
    if (invitation.account.lifecycleState === "CLOSED" || invitation.account.lifecycleState === "CLOSURE_REQUESTED") throw new OrganizationError("CLOSED_ACCOUNT");
    if (invitation.account.lifecycleState === "SUSPENDED") throw new OrganizationError("SUSPENDED_ACCOUNT");
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
    const current = await tx.customerAccount.findUniqueOrThrow({ where: { id: input.accountId }, select: { ownerId: true } });
    const member = await tx.membership.findUnique({ where: { accountId_userId: { accountId: input.accountId, userId: input.newOwnerUserId } } });
    if (!member) throw new OrganizationError("MEMBER_NOT_FOUND");
    if (input.newOwnerUserId === current.ownerId) throw new OrganizationError("MEMBER_NOT_FOUND");
    await tx.membership.update({ where: { accountId_userId: { accountId: input.accountId, userId: input.newOwnerUserId } }, data: { role: "OWNER" } });
    const account = await tx.customerAccount.update({ where: { id: input.accountId }, data: { ownerId: input.newOwnerUserId } });
    if (current.ownerId !== input.newOwnerUserId) {
      await tx.membership.updateMany({ where: { accountId: input.accountId, userId: current.ownerId, role: "OWNER" }, data: { role: "BILLING" } });
      await audit(tx as Tx, { actorId: input.actorId, accountId: input.accountId, action: "ORGANIZATION_OWNER_DEMOTED", targetType: "Membership", targetId: current.ownerId, metadata: { from: "OWNER", to: "BILLING", reason: "OWNERSHIP_TRANSFERRED" } });
    }
    await audit(tx as Tx, { actorId: input.actorId, accountId: input.accountId, action: "ORGANIZATION_OWNER_TRANSFERRED", targetType: "CustomerAccount", targetId: input.accountId, metadata: { from: current.ownerId, to: input.newOwnerUserId, previousRole: member.role, nextRole: "OWNER", previousOwnerDemoted: current.ownerId !== input.newOwnerUserId } });
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

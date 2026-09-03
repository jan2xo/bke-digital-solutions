import "server-only";
import {
  ACCOUNTS_INVITATION_ACCEPTANCE_CAPABILITY_ID,
  type AccountsInvitationAcceptanceCapability,
} from "@bke/accounts/contracts/invitation-acceptance.contract";
import {
  ACCOUNTS_INVITATION_EXPIRATION_CAPABILITY_ID,
  type AccountsInvitationExpirationCapability,
} from "@bke/accounts/contracts/invitation-expiration.contract";
import {
  ACCOUNTS_INVITATION_ISSUANCE_CAPABILITY_ID,
  type AccountsInvitationIssuanceCapability,
} from "@bke/accounts/contracts/invitation-issuance.contract";
import {
  ACCOUNTS_INVITATION_LIST_CAPABILITY_ID,
  type AccountsInvitationListCapability,
} from "@bke/accounts/contracts/invitation-list.contract";
import {
  ACCOUNTS_INVITATION_RESEND_CAPABILITY_ID,
  type AccountsInvitationResendCapability,
} from "@bke/accounts/contracts/invitation-resend.contract";
import {
  ACCOUNTS_INVITATION_REVOCATION_CAPABILITY_ID,
  type AccountsInvitationRevocationCapability,
} from "@bke/accounts/contracts/invitation-revocation.contract";
import {
  ACCOUNTS_MEMBER_LEAVE_CAPABILITY_ID,
  type AccountsMemberLeaveCapability,
} from "@bke/accounts/contracts/member-leave.contract";
import {
  ACCOUNTS_MEMBERSHIP_REMOVAL_CAPABILITY_ID,
  type AccountsMembershipRemovalCapability,
} from "@bke/accounts/contracts/membership-removal.contract";
import {
  ACCOUNTS_MEMBERSHIP_ROLE_CHANGE_CAPABILITY_ID,
  type AccountsMembershipRoleChangeCapability,
} from "@bke/accounts/contracts/membership-role-change.contract";
import {
  ACCOUNTS_ORGANIZATION_ACCOUNT_CREATION_CAPABILITY_ID,
  type AccountsOrganizationAccountCreationCapability,
} from "@bke/accounts/contracts/organization-account-creation.contract";
import {
  ACCOUNTS_ORGANIZATION_CLOSE_CAPABILITY_ID,
  type AccountsOrganizationCloseCapability,
} from "@bke/accounts/contracts/organization-close.contract";
import {
  ACCOUNTS_ORGANIZATION_PROFILE_UPDATE_CAPABILITY_ID,
  type AccountsOrganizationProfileUpdateCapability,
} from "@bke/accounts/contracts/organization-profile-update.contract";
import {
  ACCOUNTS_OWNERSHIP_TRANSFER_CAPABILITY_ID,
  type AccountsOwnershipTransferCapability,
} from "@bke/accounts/contracts/ownership-transfer.contract";
import {
  ACCOUNTS_SWITCHABLE_ACCOUNT_LIST_CAPABILITY_ID,
  type AccountsSwitchableAccountListCapability,
} from "@bke/accounts/contracts/switchable-account-list.contract";
import type { AccountsMemberRole } from "@bke/accounts/contracts/account.contract";
import { audit } from "@/lib/audit";
import { getV2WebApplication } from "../runtime";

class AccountsOperationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

type AuditIntent = {
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly accountId?: string;
  readonly metadata?: unknown;
  readonly invitationId?: string;
  readonly role?: AccountsMemberRole;
};

function reject(code: string): never {
  if (["NOT_FOUND", "INVITATION_NOT_FOUND", "MEMBER_NOT_FOUND"].includes(code)) {
    throw new AccountsOperationError(code, 404);
  }
  if (["ACCOUNT_ROLE_FORBIDDEN", "INVITATION_EMAIL_MISMATCH"].includes(code)) {
    throw new AccountsOperationError(code, 403);
  }
  if (code === "INVITATION_EXPIRED") throw new AccountsOperationError(code, 410);
  if (code === "ACCOUNT_NOT_ORGANIZATION") throw new AccountsOperationError(code, 400);
  throw new AccountsOperationError(code, 409);
}

function fail(code: string): never {
  throw new AccountsOperationError(code, code === "INVALID_INPUT" ? 422 : 503);
}

async function recordIntent(
  intent: AuditIntent,
  actorId?: string,
  fallbackAccountId?: string,
): Promise<void> {
  const derivedMetadata =
    intent.metadata !== undefined
      ? intent.metadata
      : intent.invitationId !== undefined || intent.role !== undefined
        ? {
            ...(intent.invitationId !== undefined ? { invitationId: intent.invitationId } : {}),
            ...(intent.role !== undefined ? { role: intent.role } : {}),
          }
        : undefined;
  await audit({
    actorId,
    accountId: intent.accountId ?? fallbackAccountId,
    action: intent.action,
    targetType: intent.targetType,
    targetId: intent.targetId,
    metadata: derivedMetadata,
  });
}

export async function listSwitchableAccounts(principalId: string) {
  const application = await getV2WebApplication();
  const capability = application.get<AccountsSwitchableAccountListCapability>(
    ACCOUNTS_SWITCHABLE_ACCOUNT_LIST_CAPABILITY_ID,
  );
  const result = await capability.list({ principalId });
  if (result.status === "FAILED") fail(result.code);
  return result.accounts;
}

export async function createOrganizationAccount(input: {
  actorId: string;
  displayName: string;
  legalName: string;
  billingEmail: string;
  registrationNumber?: string;
  taxId?: string;
}) {
  const application = await getV2WebApplication();
  const capability = application.get<AccountsOrganizationAccountCreationCapability>(
    ACCOUNTS_ORGANIZATION_ACCOUNT_CREATION_CAPABILITY_ID,
  );
  const result = await capability.create({
    ownerPrincipalId: input.actorId,
    displayName: input.displayName,
    legalName: input.legalName,
    billingEmail: input.billingEmail,
    registrationNumber: input.registrationNumber,
    taxId: input.taxId,
  });
  if (result.status === "FAILED") fail(result.code);
  await recordIntent(result.auditIntent, input.actorId, result.account.id);
  return result.account;
}

export async function updateOrganizationProfile(input: {
  actorId: string;
  accountId: string;
  displayName?: string;
  legalName?: string;
  billingEmail?: string;
  registrationNumber?: string | null;
  taxId?: string | null;
}) {
  const application = await getV2WebApplication();
  const capability = application.get<AccountsOrganizationProfileUpdateCapability>(
    ACCOUNTS_ORGANIZATION_PROFILE_UPDATE_CAPABILITY_ID,
  );
  const result = await capability.update({
    actorPrincipalId: input.actorId,
    accountId: input.accountId,
    displayName: input.displayName,
    legalName: input.legalName,
    billingEmail: input.billingEmail,
    registrationNumber: input.registrationNumber,
    taxId: input.taxId,
  });
  if (result.status === "REJECTED") reject(result.code);
  if (result.status === "FAILED") fail(result.code);
  await recordIntent(result.auditIntent, input.actorId, input.accountId);
  return result.state.account;
}

export async function listOrganizationInvitations(actorId: string, accountId: string) {
  const application = await getV2WebApplication();
  const capability = application.get<AccountsInvitationListCapability>(
    ACCOUNTS_INVITATION_LIST_CAPABILITY_ID,
  );
  const result = await capability.list({ actorPrincipalId: actorId, accountId });
  for (const intent of result.expiration?.auditIntents ?? []) await recordIntent(intent);
  if (result.status === "REJECTED") reject(result.code);
  if (result.status === "FAILED") fail(result.code);
  return result.invitations;
}

export async function inviteOrganizationMember(input: {
  actorId: string;
  accountId: string;
  email: string;
  role: AccountsMemberRole;
}) {
  const application = await getV2WebApplication();
  const capability = application.get<AccountsInvitationIssuanceCapability>(
    ACCOUNTS_INVITATION_ISSUANCE_CAPABILITY_ID,
  );
  const result = await capability.issue({
    actorPrincipalId: input.actorId,
    accountId: input.accountId,
    email: input.email,
    role: input.role,
  });
  if (result.status === "REJECTED") reject(result.code);
  if (result.status === "FAILED") fail(result.code);
  await recordIntent(result.auditIntent, input.actorId, result.invitation.accountId);
  return { invitation: result.invitation, token: result.token };
}

export async function resendOrganizationInvitation(input: {
  actorId: string;
  invitationId: string;
}) {
  const application = await getV2WebApplication();
  const capability = application.get<AccountsInvitationResendCapability>(
    ACCOUNTS_INVITATION_RESEND_CAPABILITY_ID,
  );
  const result = await capability.resend({
    actorPrincipalId: input.actorId,
    invitationId: input.invitationId,
  });
  if (result.status === "REJECTED") reject(result.code);
  if (result.status === "FAILED") fail(result.code);
  await recordIntent(result.auditIntent, input.actorId, result.invitation.accountId);
  return { invitation: result.invitation, token: result.token };
}

export async function revokeOrganizationInvitation(input: {
  actorId: string;
  invitationId: string;
}) {
  const application = await getV2WebApplication();
  const capability = application.get<AccountsInvitationRevocationCapability>(
    ACCOUNTS_INVITATION_REVOCATION_CAPABILITY_ID,
  );
  const result = await capability.revoke({
    actorPrincipalId: input.actorId,
    invitationId: input.invitationId,
  });
  if (result.status === "REJECTED") reject(result.code);
  if (result.status === "FAILED") fail(result.code);
  await recordIntent(result.auditIntent, input.actorId, result.invitation.accountId);
  return result.invitation;
}

export async function expirePendingOrganizationInvitations() {
  const application = await getV2WebApplication();
  const capability = application.get<AccountsInvitationExpirationCapability>(
    ACCOUNTS_INVITATION_EXPIRATION_CAPABILITY_ID,
  );
  const result = await capability.expire();
  if (result.status === "FAILED") fail(result.code);
  for (const intent of result.auditIntents) await recordIntent(intent);
  return { count: result.count };
}

export async function acceptOrganizationInvitation(input: {
  userId: string;
  email: string;
  token: string;
}) {
  const application = await getV2WebApplication();
  const capability = application.get<AccountsInvitationAcceptanceCapability>(
    ACCOUNTS_INVITATION_ACCEPTANCE_CAPABILITY_ID,
  );
  const result = await capability.accept({
    principalId: input.userId,
    email: input.email,
    token: input.token,
  });
  if (result.status === "REJECTED") reject(result.code);
  if (result.status === "FAILED") fail(result.code);
  await recordIntent(result.auditIntent, input.userId, result.membership.accountId);
  return result.membership;
}

export async function updateOrganizationMemberRole(input: {
  actorId: string;
  accountId: string;
  userId: string;
  role: AccountsMemberRole;
}) {
  const application = await getV2WebApplication();
  const capability = application.get<AccountsMembershipRoleChangeCapability>(
    ACCOUNTS_MEMBERSHIP_ROLE_CHANGE_CAPABILITY_ID,
  );
  const result = await capability.update({
    actorPrincipalId: input.actorId,
    accountId: input.accountId,
    targetPrincipalId: input.userId,
    role: input.role,
  });
  if (result.status === "REJECTED") reject(result.code);
  if (result.status === "FAILED") fail(result.code);
  await recordIntent(result.auditIntent, input.actorId, input.accountId);
  return result.membership;
}

export async function removeOrganizationMember(input: {
  actorId: string;
  accountId: string;
  userId: string;
}) {
  const application = await getV2WebApplication();
  const capability = application.get<AccountsMembershipRemovalCapability>(
    ACCOUNTS_MEMBERSHIP_REMOVAL_CAPABILITY_ID,
  );
  const result = await capability.remove({
    actorPrincipalId: input.actorId,
    accountId: input.accountId,
    targetPrincipalId: input.userId,
  });
  if (result.status === "REJECTED") reject(result.code);
  if (result.status === "FAILED") fail(result.code);
  await recordIntent(result.auditIntent, input.actorId, input.accountId);
  return result.membership;
}

export async function leaveOrganization(input: { actorId: string; accountId: string }) {
  const application = await getV2WebApplication();
  const capability = application.get<AccountsMemberLeaveCapability>(
    ACCOUNTS_MEMBER_LEAVE_CAPABILITY_ID,
  );
  const result = await capability.leave({ principalId: input.actorId, accountId: input.accountId });
  if (result.status === "REJECTED") reject(result.code);
  if (result.status === "FAILED") fail(result.code);
  await recordIntent(result.auditIntent, input.actorId, input.accountId);
  return result.membership;
}

export async function transferOrganizationOwnership(input: {
  actorId: string;
  accountId: string;
  newOwnerUserId: string;
}) {
  const application = await getV2WebApplication();
  const capability = application.get<AccountsOwnershipTransferCapability>(
    ACCOUNTS_OWNERSHIP_TRANSFER_CAPABILITY_ID,
  );
  const result = await capability.transfer({
    actorPrincipalId: input.actorId,
    accountId: input.accountId,
    newOwnerPrincipalId: input.newOwnerUserId,
  });
  if (result.status === "REJECTED") reject(result.code);
  if (result.status === "FAILED") fail(result.code);
  for (const intent of result.auditIntents) await recordIntent(intent, input.actorId, input.accountId);
  return result.account;
}

export async function closeOrganization(input: { actorId: string; accountId: string }) {
  const application = await getV2WebApplication();
  const capability = application.get<AccountsOrganizationCloseCapability>(
    ACCOUNTS_ORGANIZATION_CLOSE_CAPABILITY_ID,
  );
  const result = await capability.close({ actorPrincipalId: input.actorId, accountId: input.accountId });
  if (result.status === "REJECTED") reject(result.code);
  if (result.status === "FAILED") fail(result.code);
  await recordIntent(result.auditIntent, input.actorId, input.accountId);
  return result.account;
}

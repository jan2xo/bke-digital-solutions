import type { CapabilityModule } from "../../contracts/capability";
import { ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID } from "@bke/accounts/contracts/account-access.contract";
import { ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID } from "@bke/accounts/contracts/purchase-access.contract";
import { ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID } from "@bke/accounts/contracts/individual-account-creation.contract";
import { ACCOUNTS_INVITATION_ACCEPTANCE_CAPABILITY_ID } from "@bke/accounts/contracts/invitation-acceptance.contract";
import { ACCOUNTS_INVITATION_EXPIRATION_CAPABILITY_ID } from "@bke/accounts/contracts/invitation-expiration.contract";
import { ACCOUNTS_INVITATION_ISSUANCE_CAPABILITY_ID } from "@bke/accounts/contracts/invitation-issuance.contract";
import { ACCOUNTS_INVITATION_LIST_CAPABILITY_ID } from "@bke/accounts/contracts/invitation-list.contract";
import { ACCOUNTS_INVITATION_RESEND_CAPABILITY_ID } from "@bke/accounts/contracts/invitation-resend.contract";
import { ACCOUNTS_INVITATION_REVOCATION_CAPABILITY_ID } from "@bke/accounts/contracts/invitation-revocation.contract";
import { ACCOUNTS_MEMBER_LEAVE_CAPABILITY_ID } from "@bke/accounts/contracts/member-leave.contract";
import { ACCOUNTS_MEMBERSHIP_REMOVAL_CAPABILITY_ID } from "@bke/accounts/contracts/membership-removal.contract";
import { ACCOUNTS_MEMBERSHIP_ROLE_CHANGE_CAPABILITY_ID } from "@bke/accounts/contracts/membership-role-change.contract";
import { ACCOUNTS_ORGANIZATION_ACCOUNT_CREATION_CAPABILITY_ID } from "@bke/accounts/contracts/organization-account-creation.contract";
import { ACCOUNTS_ORGANIZATION_CLOSE_CAPABILITY_ID } from "@bke/accounts/contracts/organization-close.contract";
import { ACCOUNTS_ORGANIZATION_DETAIL_CAPABILITY_ID } from "@bke/accounts/contracts/organization-detail.contract";
import { ACCOUNTS_ORGANIZATION_PROFILE_UPDATE_CAPABILITY_ID } from "@bke/accounts/contracts/organization-profile-update.contract";
import { ACCOUNTS_OWNERSHIP_TRANSFER_CAPABILITY_ID } from "@bke/accounts/contracts/ownership-transfer.contract";
import { ACCOUNTS_SWITCHABLE_ACCOUNT_LIST_CAPABILITY_ID } from "@bke/accounts/contracts/switchable-account-list.contract";
import { createAccountsAccountAccessCapability } from "@bke/accounts/logic/account-access";
import { createAccountsPurchaseAccessCapability } from "@bke/accounts/logic/purchase-access";
import { createAccountsIndividualAccountCreationCapability } from "@bke/accounts/logic/individual-account-creation";
import { createAccountsInvitationAcceptanceCapability } from "@bke/accounts/logic/invitation-acceptance";
import { createAccountsInvitationExpirationCapability } from "@bke/accounts/logic/invitation-expiration";
import { createAccountsInvitationIssuanceCapability } from "@bke/accounts/logic/invitation-issuance";
import { createAccountsInvitationListCapability } from "@bke/accounts/logic/invitation-list";
import { createAccountsInvitationResendCapability } from "@bke/accounts/logic/invitation-resend";
import { createAccountsInvitationRevocationCapability } from "@bke/accounts/logic/invitation-revocation";
import { createAccountsMemberLeaveCapability } from "@bke/accounts/logic/member-leave";
import { createAccountsMembershipRemovalCapability } from "@bke/accounts/logic/membership-removal";
import { createAccountsMembershipRoleChangeCapability } from "@bke/accounts/logic/membership-role-change";
import { createAccountsOrganizationAccountCreationCapability } from "@bke/accounts/logic/organization-account-creation";
import { createAccountsOrganizationCloseCapability } from "@bke/accounts/logic/organization-close";
import { createAccountsOrganizationDetailCapability } from "@bke/accounts/logic/organization-detail";
import { createAccountsOrganizationProfileUpdateCapability } from "@bke/accounts/logic/organization-profile-update";
import { createAccountsOwnershipTransferCapability } from "@bke/accounts/logic/ownership-transfer";
import { createAccountsSwitchableAccountListCapability } from "@bke/accounts/logic/switchable-account-list";
import { accountsModuleManifest } from "@bke/accounts/module.manifest";
import { createPostgresAccountsAccountAccessRepository } from "@bke/accounts/prisma/repositories/postgres-account-access-repository";
import { createPostgresAccountsIndividualAccountCreationRepository } from "@bke/accounts/prisma/repositories/postgres-individual-account-creation-repository";
import { createPostgresAccountsInvitationAcceptanceRepository } from "@bke/accounts/prisma/repositories/postgres-invitation-acceptance-repository";
import { createPostgresAccountsInvitationExpirationRepository } from "@bke/accounts/prisma/repositories/postgres-invitation-expiration-repository";
import { createPostgresAccountsInvitationIssuanceRepository } from "@bke/accounts/prisma/repositories/postgres-invitation-issuance-repository";
import { createPostgresAccountsInvitationListRepository } from "@bke/accounts/prisma/repositories/postgres-invitation-list-repository";
import { createPostgresAccountsInvitationResendRepository } from "@bke/accounts/prisma/repositories/postgres-invitation-resend-repository";
import { createPostgresAccountsInvitationRevocationRepository } from "@bke/accounts/prisma/repositories/postgres-invitation-revocation-repository";
import { createPostgresAccountsMemberLeaveRepository } from "@bke/accounts/prisma/repositories/postgres-member-leave-repository";
import { createPostgresAccountsMembershipRemovalRepository } from "@bke/accounts/prisma/repositories/postgres-membership-removal-repository";
import { createPostgresAccountsMembershipRoleChangeRepository } from "@bke/accounts/prisma/repositories/postgres-membership-role-change-repository";
import { createPostgresAccountsOrganizationAccountCreationRepository } from "@bke/accounts/prisma/repositories/postgres-organization-account-creation-repository";
import { createPostgresAccountsOrganizationCloseRepository } from "@bke/accounts/prisma/repositories/postgres-organization-close-repository";
import { createPostgresAccountsOrganizationDetailRepository } from "@bke/accounts/prisma/repositories/postgres-organization-detail-repository";
import { createPostgresAccountsOrganizationProfileUpdateRepository } from "@bke/accounts/prisma/repositories/postgres-organization-profile-update-repository";
import { createPostgresAccountsOwnershipTransferRepository } from "@bke/accounts/prisma/repositories/postgres-ownership-transfer-repository";
import { createPostgresAccountsSwitchableAccountListRepository } from "@bke/accounts/prisma/repositories/postgres-switchable-account-list-repository";
import { createCryptoAccountsIdProvider } from "@bke/accounts/providers/crypto-accounts-id-provider";
import { createCryptoAccountsInvitationTokenHasher } from "@bke/accounts/providers/crypto-invitation-token-hasher";
import { createCryptoAccountsInvitationTokenProvider } from "@bke/accounts/providers/crypto-invitation-token-provider";
import { createSystemAccountsClock } from "@bke/accounts/providers/system-accounts-clock";

export interface AccountsModuleOptions {
  readonly connectionString: string;
}

export function createAccountsModule(options: AccountsModuleOptions): CapabilityModule {
  const individualAccountCreationRepository =
    createPostgresAccountsIndividualAccountCreationRepository(options.connectionString);
  const accountAccessRepository = createPostgresAccountsAccountAccessRepository(
    options.connectionString,
  );
  const switchableAccountListRepository =
    createPostgresAccountsSwitchableAccountListRepository(options.connectionString);
  const organizationAccountCreationRepository =
    createPostgresAccountsOrganizationAccountCreationRepository(options.connectionString);
  const organizationProfileUpdateRepository =
    createPostgresAccountsOrganizationProfileUpdateRepository(options.connectionString);
  const organizationCloseRepository =
    createPostgresAccountsOrganizationCloseRepository(options.connectionString);
  const organizationDetailRepository =
    createPostgresAccountsOrganizationDetailRepository(options.connectionString);
  const invitationIssuanceRepository =
    createPostgresAccountsInvitationIssuanceRepository(options.connectionString);
  const invitationListRepository =
    createPostgresAccountsInvitationListRepository(options.connectionString);
  const invitationResendRepository =
    createPostgresAccountsInvitationResendRepository(options.connectionString);
  const invitationRevocationRepository =
    createPostgresAccountsInvitationRevocationRepository(options.connectionString);
  const invitationExpirationRepository =
    createPostgresAccountsInvitationExpirationRepository(options.connectionString);
  const invitationAcceptanceRepository =
    createPostgresAccountsInvitationAcceptanceRepository(options.connectionString);
  const membershipRoleChangeRepository =
    createPostgresAccountsMembershipRoleChangeRepository(options.connectionString);
  const membershipRemovalRepository =
    createPostgresAccountsMembershipRemovalRepository(options.connectionString);
  const memberLeaveRepository = createPostgresAccountsMemberLeaveRepository(options.connectionString);
  const ownershipTransferRepository =
    createPostgresAccountsOwnershipTransferRepository(options.connectionString);
  const idProvider = createCryptoAccountsIdProvider();
  const invitationTokenProvider = createCryptoAccountsInvitationTokenProvider();
  const invitationTokenHasher = createCryptoAccountsInvitationTokenHasher();
  const clock = createSystemAccountsClock();
  const individualAccountCreation = createAccountsIndividualAccountCreationCapability(
    individualAccountCreationRepository,
    idProvider,
  );
  const accountAccess = createAccountsAccountAccessCapability(accountAccessRepository);
  const purchaseAccess = createAccountsPurchaseAccessCapability(accountAccess);
  const switchableAccountList = createAccountsSwitchableAccountListCapability(
    switchableAccountListRepository,
  );
  const organizationAccountCreation = createAccountsOrganizationAccountCreationCapability(
    organizationAccountCreationRepository,
    idProvider,
  );
  const organizationProfileUpdate = createAccountsOrganizationProfileUpdateCapability(
    accountAccess,
    organizationProfileUpdateRepository,
  );
  const organizationClose = createAccountsOrganizationCloseCapability(
    accountAccess,
    organizationCloseRepository,
    clock,
  );
  const organizationDetail = createAccountsOrganizationDetailCapability(
    accountAccess,
    organizationDetailRepository,
  );
  const invitationIssuance = createAccountsInvitationIssuanceCapability(
    accountAccess,
    invitationIssuanceRepository,
    idProvider,
    invitationTokenProvider,
    clock,
  );
  const invitationExpiration = createAccountsInvitationExpirationCapability(
    invitationExpirationRepository,
    clock,
  );
  const invitationList = createAccountsInvitationListCapability(
    invitationExpiration,
    accountAccess,
    invitationListRepository,
  );
  const invitationResend = createAccountsInvitationResendCapability(
    accountAccess,
    invitationResendRepository,
    invitationTokenProvider,
    clock,
  );
  const invitationRevocation = createAccountsInvitationRevocationCapability(
    accountAccess,
    invitationRevocationRepository,
  );
  const invitationAcceptance = createAccountsInvitationAcceptanceCapability(
    invitationAcceptanceRepository,
    invitationTokenHasher,
    clock,
  );
  const membershipRoleChange = createAccountsMembershipRoleChangeCapability(
    accountAccess,
    membershipRoleChangeRepository,
  );
  const membershipRemoval = createAccountsMembershipRemovalCapability(
    accountAccess,
    membershipRemovalRepository,
  );
  const memberLeave = createAccountsMemberLeaveCapability(accountAccess, memberLeaveRepository);
  const ownershipTransfer = createAccountsOwnershipTransferCapability(
    accountAccess,
    ownershipTransferRepository,
  );

  return Object.freeze({
    manifest: accountsModuleManifest,
    start: () => [
      {
        id: ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID,
        value: individualAccountCreation,
      },
      {
        id: ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
        value: accountAccess,
      },
      {
        id: ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
        value: purchaseAccess,
      },
      {
        id: ACCOUNTS_SWITCHABLE_ACCOUNT_LIST_CAPABILITY_ID,
        value: switchableAccountList,
      },
      {
        id: ACCOUNTS_ORGANIZATION_ACCOUNT_CREATION_CAPABILITY_ID,
        value: organizationAccountCreation,
      },
      {
        id: ACCOUNTS_ORGANIZATION_PROFILE_UPDATE_CAPABILITY_ID,
        value: organizationProfileUpdate,
      },
      {
        id: ACCOUNTS_ORGANIZATION_CLOSE_CAPABILITY_ID,
        value: organizationClose,
      },
      {
        id: ACCOUNTS_ORGANIZATION_DETAIL_CAPABILITY_ID,
        value: organizationDetail,
      },
      {
        id: ACCOUNTS_INVITATION_ISSUANCE_CAPABILITY_ID,
        value: invitationIssuance,
      },
      {
        id: ACCOUNTS_INVITATION_LIST_CAPABILITY_ID,
        value: invitationList,
      },
      {
        id: ACCOUNTS_INVITATION_RESEND_CAPABILITY_ID,
        value: invitationResend,
      },
      {
        id: ACCOUNTS_INVITATION_REVOCATION_CAPABILITY_ID,
        value: invitationRevocation,
      },
      {
        id: ACCOUNTS_INVITATION_EXPIRATION_CAPABILITY_ID,
        value: invitationExpiration,
      },
      {
        id: ACCOUNTS_INVITATION_ACCEPTANCE_CAPABILITY_ID,
        value: invitationAcceptance,
      },
      {
        id: ACCOUNTS_MEMBERSHIP_ROLE_CHANGE_CAPABILITY_ID,
        value: membershipRoleChange,
      },
      {
        id: ACCOUNTS_MEMBERSHIP_REMOVAL_CAPABILITY_ID,
        value: membershipRemoval,
      },
      {
        id: ACCOUNTS_MEMBER_LEAVE_CAPABILITY_ID,
        value: memberLeave,
      },
      {
        id: ACCOUNTS_OWNERSHIP_TRANSFER_CAPABILITY_ID,
        value: ownershipTransfer,
      },
    ],
  });
}

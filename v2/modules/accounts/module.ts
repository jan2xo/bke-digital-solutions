import type { CapabilityModule } from "../../contracts/capability";
import { ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID } from "./contracts/account-access.contract";
import { ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID } from "./contracts/individual-account-creation.contract";
import { ACCOUNTS_INVITATION_EXPIRATION_CAPABILITY_ID } from "./contracts/invitation-expiration.contract";
import { ACCOUNTS_INVITATION_ISSUANCE_CAPABILITY_ID } from "./contracts/invitation-issuance.contract";
import { ACCOUNTS_INVITATION_RESEND_CAPABILITY_ID } from "./contracts/invitation-resend.contract";
import { ACCOUNTS_INVITATION_REVOCATION_CAPABILITY_ID } from "./contracts/invitation-revocation.contract";
import { ACCOUNTS_ORGANIZATION_ACCOUNT_CREATION_CAPABILITY_ID } from "./contracts/organization-account-creation.contract";
import { ACCOUNTS_ORGANIZATION_PROFILE_UPDATE_CAPABILITY_ID } from "./contracts/organization-profile-update.contract";
import { ACCOUNTS_SWITCHABLE_ACCOUNT_LIST_CAPABILITY_ID } from "./contracts/switchable-account-list.contract";
import { createAccountsAccountAccessCapability } from "./logic/account-access";
import { createAccountsIndividualAccountCreationCapability } from "./logic/individual-account-creation";
import { createAccountsInvitationExpirationCapability } from "./logic/invitation-expiration";
import { createAccountsInvitationIssuanceCapability } from "./logic/invitation-issuance";
import { createAccountsInvitationResendCapability } from "./logic/invitation-resend";
import { createAccountsInvitationRevocationCapability } from "./logic/invitation-revocation";
import { createAccountsOrganizationAccountCreationCapability } from "./logic/organization-account-creation";
import { createAccountsOrganizationProfileUpdateCapability } from "./logic/organization-profile-update";
import { createAccountsSwitchableAccountListCapability } from "./logic/switchable-account-list";
import { accountsModuleManifest } from "./module.manifest";
import { createPostgresAccountsAccountAccessRepository } from "./prisma/repositories/postgres-account-access-repository";
import { createPostgresAccountsIndividualAccountCreationRepository } from "./prisma/repositories/postgres-individual-account-creation-repository";
import { createPostgresAccountsInvitationExpirationRepository } from "./prisma/repositories/postgres-invitation-expiration-repository";
import { createPostgresAccountsInvitationIssuanceRepository } from "./prisma/repositories/postgres-invitation-issuance-repository";
import { createPostgresAccountsInvitationResendRepository } from "./prisma/repositories/postgres-invitation-resend-repository";
import { createPostgresAccountsInvitationRevocationRepository } from "./prisma/repositories/postgres-invitation-revocation-repository";
import { createPostgresAccountsOrganizationAccountCreationRepository } from "./prisma/repositories/postgres-organization-account-creation-repository";
import { createPostgresAccountsOrganizationProfileUpdateRepository } from "./prisma/repositories/postgres-organization-profile-update-repository";
import { createPostgresAccountsSwitchableAccountListRepository } from "./prisma/repositories/postgres-switchable-account-list-repository";
import { createCryptoAccountsIdProvider } from "./providers/crypto-accounts-id-provider";
import { createCryptoAccountsInvitationTokenProvider } from "./providers/crypto-invitation-token-provider";
import { createSystemAccountsClock } from "./providers/system-accounts-clock";

export interface AccountsModuleOptions {
  readonly connectionString: string;
}

export function createAccountsModule(options: AccountsModuleOptions): CapabilityModule {
  const individualAccountCreationRepository = createPostgresAccountsIndividualAccountCreationRepository(options.connectionString);
  const accountAccessRepository = createPostgresAccountsAccountAccessRepository(options.connectionString);
  const switchableAccountListRepository = createPostgresAccountsSwitchableAccountListRepository(options.connectionString);
  const organizationAccountCreationRepository = createPostgresAccountsOrganizationAccountCreationRepository(options.connectionString);
  const organizationProfileUpdateRepository = createPostgresAccountsOrganizationProfileUpdateRepository(options.connectionString);
  const invitationIssuanceRepository = createPostgresAccountsInvitationIssuanceRepository(options.connectionString);
  const invitationResendRepository = createPostgresAccountsInvitationResendRepository(options.connectionString);
  const invitationRevocationRepository = createPostgresAccountsInvitationRevocationRepository(options.connectionString);
  const invitationExpirationRepository = createPostgresAccountsInvitationExpirationRepository(options.connectionString);
  const idProvider = createCryptoAccountsIdProvider();
  const invitationTokenProvider = createCryptoAccountsInvitationTokenProvider();
  const clock = createSystemAccountsClock();
  const individualAccountCreation = createAccountsIndividualAccountCreationCapability(individualAccountCreationRepository, idProvider);
  const accountAccess = createAccountsAccountAccessCapability(accountAccessRepository);
  const switchableAccountList = createAccountsSwitchableAccountListCapability(switchableAccountListRepository);
  const organizationAccountCreation = createAccountsOrganizationAccountCreationCapability(organizationAccountCreationRepository, idProvider);
  const organizationProfileUpdate = createAccountsOrganizationProfileUpdateCapability(accountAccess, organizationProfileUpdateRepository);
  const invitationIssuance = createAccountsInvitationIssuanceCapability(accountAccess, invitationIssuanceRepository, idProvider, invitationTokenProvider, clock);
  const invitationResend = createAccountsInvitationResendCapability(accountAccess, invitationResendRepository, invitationTokenProvider, clock);
  const invitationRevocation = createAccountsInvitationRevocationCapability(accountAccess, invitationRevocationRepository);
  const invitationExpiration = createAccountsInvitationExpirationCapability(invitationExpirationRepository, clock);

  return Object.freeze({
    manifest: accountsModuleManifest,
    start: () => [
      { id: ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID, value: individualAccountCreation },
      { id: ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID, value: accountAccess },
      { id: ACCOUNTS_SWITCHABLE_ACCOUNT_LIST_CAPABILITY_ID, value: switchableAccountList },
      { id: ACCOUNTS_ORGANIZATION_ACCOUNT_CREATION_CAPABILITY_ID, value: organizationAccountCreation },
      { id: ACCOUNTS_ORGANIZATION_PROFILE_UPDATE_CAPABILITY_ID, value: organizationProfileUpdate },
      { id: ACCOUNTS_INVITATION_ISSUANCE_CAPABILITY_ID, value: invitationIssuance },
      { id: ACCOUNTS_INVITATION_RESEND_CAPABILITY_ID, value: invitationResend },
      { id: ACCOUNTS_INVITATION_REVOCATION_CAPABILITY_ID, value: invitationRevocation },
      { id: ACCOUNTS_INVITATION_EXPIRATION_CAPABILITY_ID, value: invitationExpiration },
    ],
  });
}

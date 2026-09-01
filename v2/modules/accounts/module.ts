import type { CapabilityModule } from "../../contracts/capability";
import { ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID } from "./contracts/account-access.contract";
import { ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID } from "./contracts/individual-account-creation.contract";
import { ACCOUNTS_ORGANIZATION_ACCOUNT_CREATION_CAPABILITY_ID } from "./contracts/organization-account-creation.contract";
import { ACCOUNTS_SWITCHABLE_ACCOUNT_LIST_CAPABILITY_ID } from "./contracts/switchable-account-list.contract";
import { createAccountsAccountAccessCapability } from "./logic/account-access";
import { createAccountsIndividualAccountCreationCapability } from "./logic/individual-account-creation";
import { createAccountsOrganizationAccountCreationCapability } from "./logic/organization-account-creation";
import { createAccountsSwitchableAccountListCapability } from "./logic/switchable-account-list";
import { accountsModuleManifest } from "./module.manifest";
import { createPostgresAccountsAccountAccessRepository } from "./prisma/repositories/postgres-account-access-repository";
import { createPostgresAccountsIndividualAccountCreationRepository } from "./prisma/repositories/postgres-individual-account-creation-repository";
import { createPostgresAccountsOrganizationAccountCreationRepository } from "./prisma/repositories/postgres-organization-account-creation-repository";
import { createPostgresAccountsSwitchableAccountListRepository } from "./prisma/repositories/postgres-switchable-account-list-repository";
import { createCryptoAccountsIdProvider } from "./providers/crypto-accounts-id-provider";

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
  const idProvider = createCryptoAccountsIdProvider();
  const individualAccountCreation = createAccountsIndividualAccountCreationCapability(
    individualAccountCreationRepository,
    idProvider,
  );
  const accountAccess = createAccountsAccountAccessCapability(accountAccessRepository);
  const switchableAccountList = createAccountsSwitchableAccountListCapability(
    switchableAccountListRepository,
  );
  const organizationAccountCreation = createAccountsOrganizationAccountCreationCapability(
    organizationAccountCreationRepository,
    idProvider,
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
        id: ACCOUNTS_SWITCHABLE_ACCOUNT_LIST_CAPABILITY_ID,
        value: switchableAccountList,
      },
      {
        id: ACCOUNTS_ORGANIZATION_ACCOUNT_CREATION_CAPABILITY_ID,
        value: organizationAccountCreation,
      },
    ],
  });
}

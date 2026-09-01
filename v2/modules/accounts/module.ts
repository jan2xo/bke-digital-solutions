import type { CapabilityModule } from "../../contracts/capability";
import { ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID } from "./contracts/account-access.contract";
import { ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID } from "./contracts/individual-account-creation.contract";
import { createAccountsAccountAccessCapability } from "./logic/account-access";
import { createAccountsIndividualAccountCreationCapability } from "./logic/individual-account-creation";
import { accountsModuleManifest } from "./module.manifest";
import { createPostgresAccountsAccountAccessRepository } from "./prisma/repositories/postgres-account-access-repository";
import { createPostgresAccountsIndividualAccountCreationRepository } from "./prisma/repositories/postgres-individual-account-creation-repository";
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
  const idProvider = createCryptoAccountsIdProvider();
  const individualAccountCreation = createAccountsIndividualAccountCreationCapability(
    individualAccountCreationRepository,
    idProvider,
  );
  const accountAccess = createAccountsAccountAccessCapability(accountAccessRepository);

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
    ],
  });
}

import type { CapabilityModule } from "../../contracts/capability";
import { ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID } from "./contracts/individual-account-creation.contract";
import { createAccountsIndividualAccountCreationCapability } from "./logic/individual-account-creation";
import { accountsModuleManifest } from "./module.manifest";
import { createPostgresAccountsIndividualAccountCreationRepository } from "./prisma/repositories/postgres-individual-account-creation-repository";
import { createCryptoAccountsIdProvider } from "./providers/crypto-accounts-id-provider";

export interface AccountsModuleOptions {
  readonly connectionString: string;
}

export function createAccountsModule(options: AccountsModuleOptions): CapabilityModule {
  const repository = createPostgresAccountsIndividualAccountCreationRepository(
    options.connectionString,
  );
  const idProvider = createCryptoAccountsIdProvider();
  const capability = createAccountsIndividualAccountCreationCapability(repository, idProvider);

  return Object.freeze({
    manifest: accountsModuleManifest,
    start: () => [
      {
        id: ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID,
        value: capability,
      },
    ],
  });
}

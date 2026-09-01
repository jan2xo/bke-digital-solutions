import { ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID } from "./contracts/account-access.contract";
import { ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID } from "./contracts/individual-account-creation.contract";
import type { AccountsModuleManifest } from "./contracts/module.contract";

export const accountsModuleManifest = Object.freeze({
  moduleId: "accounts",
  needs: [],
  provides: [
    ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID,
    ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
  ],
} as const satisfies AccountsModuleManifest);

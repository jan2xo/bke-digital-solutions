import { describe, expect, it } from "vitest";
import { composeCapabilities } from "../../../platform/composition/composer";
import {
  ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
  type AccountsAccountAccessCapability,
} from "../contracts/account-access.contract";
import {
  ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID,
  type AccountsIndividualAccountCreationCapability,
} from "../contracts/individual-account-creation.contract";
import { createAccountsModule } from "../module";

describe("Accounts module composition", () => {
  it("registers Accounts capabilities without touching persistence at startup", async () => {
    const application = await composeCapabilities([
      createAccountsModule({ connectionString: "postgresql://unused.invalid/accounts" }),
    ]);
    expect(application.has(ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID)).toBe(true);
    expect(
      typeof application.get<AccountsIndividualAccountCreationCapability>(
        ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID,
      ).create,
    ).toBe("function");
    expect(
      typeof application.get<AccountsAccountAccessCapability>(
        ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
      ).authorize,
    ).toBe("function");
  });
});

import { describe, expect, it } from "vitest";
import { composeCapabilities } from "../../../platform/composition/composer";
import {
  ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID,
  type AccountsIndividualAccountCreationCapability,
} from "../contracts/individual-account-creation.contract";
import { createAccountsModule } from "../module";

describe("Accounts module composition", () => {
  it("registers the individual account creation capability without touching persistence at startup", async () => {
    const application = await composeCapabilities([
      createAccountsModule({ connectionString: "postgresql://unused.invalid/accounts" }),
    ]);
    expect(application.has(ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID)).toBe(true);
    const capability = application.get<AccountsIndividualAccountCreationCapability>(
      ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID,
    );
    expect(typeof capability.create).toBe("function");
  });
});

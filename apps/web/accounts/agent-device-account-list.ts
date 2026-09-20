import "server-only";

import {
  ACCOUNTS_SWITCHABLE_ACCOUNT_LIST_CAPABILITY_ID,
  type AccountsSwitchableAccountListCapability,
  type AccountsSwitchableAccountListItem,
} from "@bke/accounts/contracts/switchable-account-list.contract";
import { getV2WebApplication } from "../runtime";

export async function listAgentDeviceAuthorizationAccounts(
  principalId: string,
): Promise<readonly AccountsSwitchableAccountListItem[]> {
  const application = await getV2WebApplication();
  const capability = application.get<AccountsSwitchableAccountListCapability>(
    ACCOUNTS_SWITCHABLE_ACCOUNT_LIST_CAPABILITY_ID,
  );
  const result = await capability.list({ principalId });
  if (result.status === "FAILED") throw new Error(result.code);
  return result.accounts;
}

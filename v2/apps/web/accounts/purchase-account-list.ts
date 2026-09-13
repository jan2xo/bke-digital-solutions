import "server-only";
import {
  ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
  type AccountsPurchaseAccessCapability,
} from "@bke/accounts/contracts/purchase-access.contract";
import {
  ACCOUNTS_SWITCHABLE_ACCOUNT_LIST_CAPABILITY_ID,
  type AccountsSwitchableAccountListCapability,
} from "@bke/accounts/contracts/switchable-account-list.contract";
import { getV2WebApplication } from "../runtime";

export interface PurchaseAuthorizedAccountOption {
  readonly id: string;
  readonly displayName: string;
}

export async function listPurchaseAuthorizedAccounts(
  principalId: string,
): Promise<readonly PurchaseAuthorizedAccountOption[]> {
  const application = await getV2WebApplication();
  const switchableAccounts = application.get<AccountsSwitchableAccountListCapability>(
    ACCOUNTS_SWITCHABLE_ACCOUNT_LIST_CAPABILITY_ID,
  );
  const switchableResult = await switchableAccounts.list({ principalId });
  if (switchableResult.status === "FAILED") throw new Error(switchableResult.code);

  const purchaseAccess = application.get<AccountsPurchaseAccessCapability>(
    ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
  );
  const authorized: PurchaseAuthorizedAccountOption[] = [];
  for (const account of switchableResult.accounts) {
    const access = await purchaseAccess.authorize({ principalId, accountId: account.id });
    if (access.status === "FAILED") throw new Error(access.code);
    if (access.status === "AUTHORIZED") {
      authorized.push({ id: access.account.id, displayName: access.account.displayName });
    }
  }
  return Object.freeze(authorized);
}

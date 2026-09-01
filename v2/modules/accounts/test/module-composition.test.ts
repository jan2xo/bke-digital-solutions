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
import {
  ACCOUNTS_INVITATION_ACCEPTANCE_CAPABILITY_ID,
  type AccountsInvitationAcceptanceCapability,
} from "../contracts/invitation-acceptance.contract";
import {
  ACCOUNTS_INVITATION_EXPIRATION_CAPABILITY_ID,
  type AccountsInvitationExpirationCapability,
} from "../contracts/invitation-expiration.contract";
import {
  ACCOUNTS_INVITATION_ISSUANCE_CAPABILITY_ID,
  type AccountsInvitationIssuanceCapability,
} from "../contracts/invitation-issuance.contract";
import {
  ACCOUNTS_INVITATION_RESEND_CAPABILITY_ID,
  type AccountsInvitationResendCapability,
} from "../contracts/invitation-resend.contract";
import {
  ACCOUNTS_INVITATION_REVOCATION_CAPABILITY_ID,
  type AccountsInvitationRevocationCapability,
} from "../contracts/invitation-revocation.contract";
import {
  ACCOUNTS_MEMBER_LEAVE_CAPABILITY_ID,
  type AccountsMemberLeaveCapability,
} from "../contracts/member-leave.contract";
import {
  ACCOUNTS_MEMBERSHIP_REMOVAL_CAPABILITY_ID,
  type AccountsMembershipRemovalCapability,
} from "../contracts/membership-removal.contract";
import {
  ACCOUNTS_MEMBERSHIP_ROLE_CHANGE_CAPABILITY_ID,
  type AccountsMembershipRoleChangeCapability,
} from "../contracts/membership-role-change.contract";
import {
  ACCOUNTS_ORGANIZATION_ACCOUNT_CREATION_CAPABILITY_ID,
  type AccountsOrganizationAccountCreationCapability,
} from "../contracts/organization-account-creation.contract";
import {
  ACCOUNTS_ORGANIZATION_CLOSE_CAPABILITY_ID,
  type AccountsOrganizationCloseCapability,
} from "../contracts/organization-close.contract";
import {
  ACCOUNTS_ORGANIZATION_DETAIL_CAPABILITY_ID,
  type AccountsOrganizationDetailCapability,
} from "../contracts/organization-detail.contract";
import {
  ACCOUNTS_ORGANIZATION_PROFILE_UPDATE_CAPABILITY_ID,
  type AccountsOrganizationProfileUpdateCapability,
} from "../contracts/organization-profile-update.contract";
import {
  ACCOUNTS_OWNERSHIP_TRANSFER_CAPABILITY_ID,
  type AccountsOwnershipTransferCapability,
} from "../contracts/ownership-transfer.contract";
import {
  ACCOUNTS_SWITCHABLE_ACCOUNT_LIST_CAPABILITY_ID,
  type AccountsSwitchableAccountListCapability,
} from "../contracts/switchable-account-list.contract";
import { createAccountsModule } from "../module";

describe("Accounts module composition", () => {
  it("registers Accounts capabilities without touching persistence at startup", async () => {
    const application = await composeCapabilities([
      createAccountsModule({ connectionString: "postgresql://unused.invalid/accounts" }),
    ]);
    expect(application.has(ACCOUNTS_INDIVIDUAL_ACCOUNT_CREATION_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_SWITCHABLE_ACCOUNT_LIST_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_ORGANIZATION_ACCOUNT_CREATION_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_ORGANIZATION_PROFILE_UPDATE_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_ORGANIZATION_CLOSE_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_ORGANIZATION_DETAIL_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_INVITATION_ISSUANCE_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_INVITATION_RESEND_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_INVITATION_REVOCATION_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_INVITATION_EXPIRATION_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_INVITATION_ACCEPTANCE_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_MEMBERSHIP_ROLE_CHANGE_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_MEMBERSHIP_REMOVAL_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_MEMBER_LEAVE_CAPABILITY_ID)).toBe(true);
    expect(application.has(ACCOUNTS_OWNERSHIP_TRANSFER_CAPABILITY_ID)).toBe(true);
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
    expect(
      typeof application.get<AccountsSwitchableAccountListCapability>(
        ACCOUNTS_SWITCHABLE_ACCOUNT_LIST_CAPABILITY_ID,
      ).list,
    ).toBe("function");
    expect(
      typeof application.get<AccountsOrganizationAccountCreationCapability>(
        ACCOUNTS_ORGANIZATION_ACCOUNT_CREATION_CAPABILITY_ID,
      ).create,
    ).toBe("function");
    expect(
      typeof application.get<AccountsOrganizationProfileUpdateCapability>(
        ACCOUNTS_ORGANIZATION_PROFILE_UPDATE_CAPABILITY_ID,
      ).update,
    ).toBe("function");
    expect(
      typeof application.get<AccountsOrganizationCloseCapability>(
        ACCOUNTS_ORGANIZATION_CLOSE_CAPABILITY_ID,
      ).close,
    ).toBe("function");
    expect(
      typeof application.get<AccountsOrganizationDetailCapability>(
        ACCOUNTS_ORGANIZATION_DETAIL_CAPABILITY_ID,
      ).get,
    ).toBe("function");
    expect(
      typeof application.get<AccountsInvitationIssuanceCapability>(
        ACCOUNTS_INVITATION_ISSUANCE_CAPABILITY_ID,
      ).issue,
    ).toBe("function");
    expect(
      typeof application.get<AccountsInvitationResendCapability>(
        ACCOUNTS_INVITATION_RESEND_CAPABILITY_ID,
      ).resend,
    ).toBe("function");
    expect(
      typeof application.get<AccountsInvitationRevocationCapability>(
        ACCOUNTS_INVITATION_REVOCATION_CAPABILITY_ID,
      ).revoke,
    ).toBe("function");
    expect(
      typeof application.get<AccountsInvitationExpirationCapability>(
        ACCOUNTS_INVITATION_EXPIRATION_CAPABILITY_ID,
      ).expire,
    ).toBe("function");
    expect(
      typeof application.get<AccountsInvitationAcceptanceCapability>(
        ACCOUNTS_INVITATION_ACCEPTANCE_CAPABILITY_ID,
      ).accept,
    ).toBe("function");
    expect(
      typeof application.get<AccountsMembershipRoleChangeCapability>(
        ACCOUNTS_MEMBERSHIP_ROLE_CHANGE_CAPABILITY_ID,
      ).update,
    ).toBe("function");
    expect(
      typeof application.get<AccountsMembershipRemovalCapability>(
        ACCOUNTS_MEMBERSHIP_REMOVAL_CAPABILITY_ID,
      ).remove,
    ).toBe("function");
    expect(
      typeof application.get<AccountsMemberLeaveCapability>(
        ACCOUNTS_MEMBER_LEAVE_CAPABILITY_ID,
      ).leave,
    ).toBe("function");
    expect(
      typeof application.get<AccountsOwnershipTransferCapability>(
        ACCOUNTS_OWNERSHIP_TRANSFER_CAPABILITY_ID,
      ).transfer,
    ).toBe("function");
  });
});

import "server-only";

import {
  ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
  type AccountsAccountAccessCapability,
} from "@bke/accounts/contracts/account-access.contract";
import { roleHasAccountsCapability } from "@bke/accounts/logic/account-authorization-policy";
import { issueAgentOrganizationInvitationManagementHandle } from "@/apps/web/accounts/agent-organization-invitation-management";
import { db } from "@/platform/host/db";
import { getV2WebApplication } from "@/apps/web/runtime";

export type AgentOrganizationOverview =
  | {
      readonly status: "ready";
      readonly displayName: string;
      readonly lifecycleState: string;
      readonly role: string;
      readonly permissions: {
        readonly manageMembers: boolean;
        readonly viewBilling: boolean;
        readonly viewLicenses: boolean;
      };
      readonly organization: {
        readonly legalName: string;
        readonly registrationNumber: string | null;
      };
      readonly billingEmail: string | null;
      readonly taxId: string | null;
      readonly counts: {
        readonly licenses: number | null;
        readonly subscriptions: number | null;
        readonly orders: number | null;
      };
      readonly members: readonly {
        readonly email: string;
        readonly name: string | null;
        readonly role: string;
      }[];
      readonly invitations: readonly {
        readonly email: string;
        readonly role: string;
        readonly status: string;
        readonly expiresAt: Date;
        readonly createdAt: Date;
        readonly managementHandle: string;
      }[];
    }
  | { readonly status: "not_organization" }
  | { readonly status: "forbidden" }
  | { readonly status: "failed" };

export async function getAgentOrganizationOverview(input: {
  principalId: string;
  accountId: string;
}): Promise<AgentOrganizationOverview> {
  const application = await getV2WebApplication();
  const accountAccess = application.get<AccountsAccountAccessCapability>(
    ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
  );
  const access = await accountAccess.authorize({
    principalId: input.principalId,
    accountId: input.accountId,
  });

  if (access.status === "REJECTED") {
    return { status: "forbidden" };
  }
  if (access.status === "FAILED") {
    return { status: "failed" };
  }
  if (access.account.type !== "ORGANIZATION") {
    return { status: "not_organization" };
  }

  const manageMembers = roleHasAccountsCapability(
    access.effectiveRole,
    "MANAGE_MEMBERS",
  );
  const viewBilling = roleHasAccountsCapability(
    access.effectiveRole,
    "VIEW_PAYMENTS",
  );
  const viewLicenses = roleHasAccountsCapability(
    access.effectiveRole,
    "VIEW_LICENSES",
  );

  const account = await db.customerAccount.findUnique({
    where: { id: input.accountId },
    select: {
      type: true,
      displayName: true,
      lifecycleState: true,
      organization: {
        select: {
          legalName: true,
          registrationNumber: true,
        },
      },
      _count: {
        select: {
          licenses: true,
          subscriptions: true,
          orders: true,
        },
      },
    },
  });

  const [memberships, invitations] = manageMembers
    ? await Promise.all([
        db.membership.findMany({
          where: { accountId: input.accountId },
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            user: {
              select: {
                email: true,
                name: true,
              },
            },
          },
        }),
        db.invitation.findMany({
          where: {
            accountId: input.accountId,
            status: "PENDING",
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
            expiresAt: true,
            createdAt: true,
          },
        }),
      ])
    : [[], []] as const;


  if (
    !account ||
    account.type !== "ORGANIZATION" ||
    !account.organization
  ) {
    return { status: "failed" };
  }

  return {
    status: "ready",
    displayName: account.displayName,
    lifecycleState: account.lifecycleState,
    role: access.effectiveRole,
    permissions: {
      manageMembers,
      viewBilling,
      viewLicenses,
    },
    organization: {
      legalName: account.organization.legalName,
      registrationNumber: account.organization.registrationNumber,
    },
    billingEmail: viewBilling ? access.account.billingEmail : null,
    taxId: viewBilling ? access.account.taxId : null,
    counts: {
      licenses: viewLicenses ? account._count.licenses : null,
      subscriptions:
        viewBilling || viewLicenses
          ? account._count.subscriptions
          : null,
      orders: viewBilling ? account._count.orders : null,
    },
    members: manageMembers
      ? memberships.map((membership) => ({
          email: membership.user.email,
          name: membership.user.name,
          role: membership.role,
        }))
      : [],
    invitations: manageMembers
      ? invitations.map((invitation) => ({
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
          managementHandle:
            issueAgentOrganizationInvitationManagementHandle(
              input.accountId,
              invitation.id,
            ),
        }))
      : [],
  };
}

import {
  ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
  type AccountsAccountAccessCapability,
} from "@bke/accounts/contracts/account-access.contract";
import { roleHasAccountsCapability } from "@bke/accounts/logic/account-authorization-policy";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { updateOrganizationProfile } from "@/v2/apps/web/accounts/organization-operations";
import { requireIdentityUser } from "@/v2/apps/web/auth/session";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { getV2WebApplication } from "@/v2/apps/web/runtime";

const schema = z
  .object({
    displayName: z.string().trim().min(2).max(120).optional(),
    legalName: z.string().trim().min(2).max(180).optional(),
    billingEmail: z.string().trim().email().optional(),
    registrationNumber: z.string().trim().max(80).nullable().optional(),
    taxId: z.string().trim().max(80).nullable().optional(),
  })
  .strict();

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireIdentityUser();
    const { id } = await params;
    const application = await getV2WebApplication();
    const accountAccess = application.get<AccountsAccountAccessCapability>(
      ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
    );
    const access = await accountAccess.authorize({ principalId: principal.id, accountId: id });
    if (access.status === "REJECTED" || access.status === "FAILED") throw new Error(access.code);
    const canManageMembers = roleHasAccountsCapability(access.effectiveRole, "MANAGE_MEMBERS");
    const canViewBilling = roleHasAccountsCapability(access.effectiveRole, "VIEW_PAYMENTS");
    const canViewLicenses = roleHasAccountsCapability(access.effectiveRole, "VIEW_LICENSES");
    const account = await db.customerAccount.findUniqueOrThrow({
      where: { id },
      include: {
        organization: true,
        memberships: {
          include: { user: { select: { id: true, email: true, name: true } } },
          orderBy: { createdAt: "asc" },
        },
        invitations: canManageMembers
          ? {
              where: { status: "PENDING" },
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                email: true,
                role: true,
                status: true,
                expiresAt: true,
                createdAt: true,
              },
            }
          : false,
        _count: { select: { licenses: true, subscriptions: true, orders: true } },
      },
    });
    return NextResponse.json({
      id: account.id,
      type: account.type,
      displayName: account.displayName,
      lifecycleState: account.lifecycleState,
      role: access.effectiveRole,
      organization: account.organization,
      billingEmail: canViewBilling ? account.billingEmail : null,
      taxId: canViewBilling ? account.taxId : null,
      counts: {
        licenses: canViewLicenses ? account._count.licenses : null,
        subscriptions: canViewBilling || canViewLicenses ? account._count.subscriptions : null,
        orders: canViewBilling ? account._count.orders : null,
      },
      memberships: canManageMembers
        ? account.memberships.map((membership) => ({
            userId: membership.userId,
            role: membership.role,
            email: membership.user.email,
            name: membership.user.name,
          }))
        : [],
      invitations: canManageMembers ? account.invitations : [],
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const principal = await requireIdentityUser();
    const { id } = await params;
    const input = schema.parse(await request.json());
    const account = await updateOrganizationProfile({ actorId: principal.id, accountId: id, ...input });
    return NextResponse.json({ id: account.id });
  } catch (error) {
    return apiError(error);
  }
}

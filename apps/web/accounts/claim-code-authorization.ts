import "server-only";

import type { AccountsMemberRole } from "@bke/accounts/contracts/account.contract";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { db } from "@/platform/host/db";

export type ClaimAccountCapability = "CLAIM_ENTITLEMENT" | "MANAGE_CLAIM_CODES";

const claimCapabilities: Record<AccountsMemberRole, ReadonlySet<ClaimAccountCapability>> = {
  OWNER: new Set(["CLAIM_ENTITLEMENT", "MANAGE_CLAIM_CODES"]),
  BILLING: new Set(["CLAIM_ENTITLEMENT", "MANAGE_CLAIM_CODES"]),
  LICENSE_MANAGER: new Set(["CLAIM_ENTITLEMENT", "MANAGE_CLAIM_CODES"]),
  MEMBER: new Set(),
};

export function roleHasClaimAccountCapability(
  role: AccountsMemberRole,
  capability: ClaimAccountCapability,
): boolean {
  return claimCapabilities[role].has(capability);
}

export async function requireClaimAccountCapabilityInTransaction(
  tx: Prisma.TransactionClient,
  principalId: string,
  accountId: string,
  capability: ClaimAccountCapability,
) {
  const normalizedPrincipalId = principalId.trim();
  const normalizedAccountId = accountId.trim();
  if (!normalizedPrincipalId || !normalizedAccountId) throw new Error("ACCOUNT_ROLE_FORBIDDEN");

  const account = await tx.customerAccount.findFirst({
    where: {
      id: normalizedAccountId,
      OR: [
        { ownerId: normalizedPrincipalId },
        { memberships: { some: { userId: normalizedPrincipalId } } },
      ],
    },
    include: {
      memberships: {
        where: { userId: normalizedPrincipalId },
        take: 1,
      },
    },
  });

  if (!account) throw new Error("NOT_FOUND");

  const effectiveRole = (
    account.ownerId === normalizedPrincipalId
      ? "OWNER"
      : account.memberships[0]?.role
  ) as AccountsMemberRole | undefined;

  if (!effectiveRole || !roleHasClaimAccountCapability(effectiveRole, capability)) {
    throw new Error("ACCOUNT_ROLE_FORBIDDEN");
  }

  return Object.assign(account, { effectiveRole });
}


export interface ClaimAuthorizedAccountOption {
  readonly id: string;
  readonly displayName: string;
  readonly type: "PERSONAL" | "ORGANIZATION";
  readonly effectiveRole: AccountsMemberRole;
}

export async function listClaimAuthorizedAccounts(
  principalId: string,
): Promise<readonly ClaimAuthorizedAccountOption[]> {
  const normalizedPrincipalId = principalId.trim();
  if (!normalizedPrincipalId) return Object.freeze([]);

  const accounts = await db.customerAccount.findMany({
    where: {
      lifecycleState: "ACTIVE",
      OR: [
        { ownerId: normalizedPrincipalId },
        { memberships: { some: { userId: normalizedPrincipalId } } },
      ],
    },
    include: {
      memberships: {
        where: { userId: normalizedPrincipalId },
        select: { role: true },
        take: 1,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return Object.freeze(accounts.flatMap((account) => {
    const effectiveRole = (
      account.ownerId === normalizedPrincipalId
        ? "OWNER"
        : account.memberships[0]?.role
    ) as AccountsMemberRole | undefined;
    if (!effectiveRole || !roleHasClaimAccountCapability(effectiveRole, "CLAIM_ENTITLEMENT")) {
      return [];
    }
    return [{
      id: account.id,
      displayName: account.displayName,
      type: account.type,
      effectiveRole,
    }];
  }));
}

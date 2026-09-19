import "server-only";

import type { AccountsMemberRole } from "@bke/accounts/contracts/account.contract";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";

export interface AgentDeviceAuthorizedAccount {
  readonly id: string;
  readonly type: "INDIVIDUAL" | "ORGANIZATION";
  readonly displayName: string;
  readonly effectiveRole: AccountsMemberRole;
}

export async function requireAgentDeviceAccountAccessInTransaction(
  tx: Prisma.TransactionClient,
  principalId: string,
  accountId: string,
): Promise<AgentDeviceAuthorizedAccount> {
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
  if (account.lifecycleState === "SUSPENDED") throw new Error("SUSPENDED_ACCOUNT");
  if (account.lifecycleState === "CLOSED") throw new Error("CLOSED_ACCOUNT");
  if (account.lifecycleState !== "ACTIVE") throw new Error("ACCOUNT_NOT_ACTIVE");

  const effectiveRole = (
    account.ownerId === normalizedPrincipalId
      ? "OWNER"
      : account.memberships[0]?.role
  ) as AccountsMemberRole | undefined;
  if (!effectiveRole) throw new Error("ACCOUNT_ROLE_FORBIDDEN");

  return Object.freeze({
    id: account.id,
    type: account.type,
    displayName: account.displayName,
    effectiveRole,
  });
}

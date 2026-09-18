import "server-only";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { db } from "@/platform/host/db";

export type AccountRole = "OWNER" | "BILLING" | "LICENSE_MANAGER" | "MEMBER";
export type AccountCapability =
  | "VIEW_ORDERS" | "VIEW_INVOICES" | "VIEW_PAYMENTS" | "PURCHASE" | "RENEW"
  | "CANCEL_PENDING_ORDER" | "VIEW_SUBSCRIPTIONS" | "VIEW_LICENSES" | "REVEAL_LICENSE"
  | "ASSIGN_LICENSE" | "DEACTIVATE_DEVICE" | "DOWNLOAD_INSTALLER" | "START_TRIAL"
  | "MANAGE_MEMBERS" | "CLOSE_ACCOUNT" | "CLAIM_ENTITLEMENT" | "MANAGE_CLAIM_CODES";

const matrix: Record<AccountRole, ReadonlySet<AccountCapability>> = {
  OWNER: new Set<AccountCapability>(["VIEW_ORDERS", "VIEW_INVOICES", "VIEW_PAYMENTS", "PURCHASE", "RENEW", "CANCEL_PENDING_ORDER", "VIEW_SUBSCRIPTIONS", "VIEW_LICENSES", "REVEAL_LICENSE", "ASSIGN_LICENSE", "DEACTIVATE_DEVICE", "DOWNLOAD_INSTALLER", "START_TRIAL", "MANAGE_MEMBERS", "CLOSE_ACCOUNT", "CLAIM_ENTITLEMENT", "MANAGE_CLAIM_CODES"]),
  BILLING: new Set<AccountCapability>(["VIEW_ORDERS", "VIEW_INVOICES", "VIEW_PAYMENTS", "PURCHASE", "RENEW", "CANCEL_PENDING_ORDER", "VIEW_SUBSCRIPTIONS", "START_TRIAL", "CLAIM_ENTITLEMENT", "MANAGE_CLAIM_CODES"]),
  LICENSE_MANAGER: new Set<AccountCapability>(["VIEW_SUBSCRIPTIONS", "VIEW_LICENSES", "REVEAL_LICENSE", "ASSIGN_LICENSE", "DEACTIVATE_DEVICE", "DOWNLOAD_INSTALLER", "CLAIM_ENTITLEMENT", "MANAGE_CLAIM_CODES"]),
  MEMBER: new Set<AccountCapability>([]),
};

export class AccountAuthorizationError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "ACCOUNT_ROLE_FORBIDDEN" | "LAST_OWNER_REQUIRED") { super(code); }
}

export function roleHasCapability(role: AccountRole, capability: AccountCapability) { return matrix[role].has(capability); }

type AccountAuthorizationClient = Pick<Prisma.TransactionClient, "customerAccount">;

async function requireAccountAccessWithClient(
  client: AccountAuthorizationClient,
  userId: string,
  accountId: string,
  capability?: AccountCapability,
) {
  const account = await client.customerAccount.findFirst({
    where: { id: accountId, OR: [{ ownerId: userId }, { memberships: { some: { userId } } }] },
    include: { memberships: { where: { userId }, take: 1 } },
  });
  if (!account) throw new AccountAuthorizationError("NOT_FOUND");
  const role = (account.ownerId === userId ? "OWNER" : account.memberships[0]?.role) as AccountRole | undefined;
  if (!role || (capability && !roleHasCapability(role, capability))) throw new AccountAuthorizationError("ACCOUNT_ROLE_FORBIDDEN");
  return Object.assign(account, { effectiveRole: role });
}

export async function requireAccountAccess(userId: string, accountId: string, capability?: AccountCapability) {
  return requireAccountAccessWithClient(db, userId, accountId, capability);
}

export async function requireAccountCapability(userId: string, accountId: string, capability: AccountCapability) {
  return requireAccountAccess(userId, accountId, capability);
}

export async function requireAccountCapabilityInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  accountId: string,
  capability: AccountCapability,
) {
  return requireAccountAccessWithClient(tx, userId, accountId, capability);
}

export function assertLastOwnerPreserved(input: { currentRole: AccountRole; nextRole?: AccountRole; ownerCount: number }) {
  if (input.currentRole === "OWNER" && input.nextRole !== "OWNER" && input.ownerCount <= 1) throw new AccountAuthorizationError("LAST_OWNER_REQUIRED");
}

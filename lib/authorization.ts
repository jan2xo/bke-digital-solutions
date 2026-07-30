import "server-only";
import { db } from "@/lib/db";

const rank = { MEMBER: 0, LICENSE_MANAGER: 1, BILLING: 2, OWNER: 3 } as const;
export type AccountPermission = keyof typeof rank;

export async function requireAccountAccess(userId: string, accountId: string, minimum: AccountPermission = "MEMBER") {
  const account = await db.customerAccount.findFirst({
    where: { id: accountId, OR: [{ ownerId: userId }, { memberships: { some: { userId } } }] },
    include: { memberships: { where: { userId }, take: 1 } },
  });
  if (!account) throw new Error("NOT_FOUND");
  const role = account.ownerId === userId ? "OWNER" : account.memberships[0]?.role;
  if (!role || rank[role] < rank[minimum]) throw new Error("FORBIDDEN");
  return account;
}

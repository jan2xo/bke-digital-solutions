import "server-only";

import {
  decideSelfPurchaseContinuation,
  type SelfPurchaseContinuation,
} from "@/apps/web/licensing/self-purchase-continuation-policy";
import { db } from "@/platform/host/db";

export async function resolveSelfPurchaseContinuation(input: {
  readonly accountId: string;
  readonly editionId: string;
  readonly purchasePlanId: string;
}): Promise<SelfPurchaseContinuation> {
  const licenses = await db.license.findMany({
    where: {
      accountId: input.accountId,
      editionId: input.editionId,
      status: "ACTIVE",
    },
    orderBy: { createdAt: "desc" },
    select: {
      purchasePlanId: true,
      subscription: {
        select: {
          id: true,
          status: true,
          purchasePlanId: true,
        },
      },
    },
  });

  return decideSelfPurchaseContinuation(
    input.purchasePlanId,
    licenses,
  );
}

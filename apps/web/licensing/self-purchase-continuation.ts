import "server-only";

import { db } from "@/platform/host/db";

export type SelfPurchaseContinuation =
  | Readonly<{ mode: "NEW" }>
  | Readonly<{ mode: "RENEW"; subscriptionId: string }>
  | Readonly<{
      mode: "CONFLICT";
      reason: "ALREADY_OWNED" | "PLAN_CHANGE_REQUIRED";
    }>;

export type SelfPurchaseLicenseFact = Readonly<{
  purchasePlanId: string | null;
  subscription: Readonly<{
    id: string;
    status: "PENDING" | "ACTIVE" | "PAST_DUE" | "EXPIRED" | "CANCELLED";
    purchasePlanId: string | null;
  }> | null;
}>;

export function decideSelfPurchaseContinuation(
  purchasePlanId: string,
  licenses: readonly SelfPurchaseLicenseFact[],
): SelfPurchaseContinuation {
  const selected = licenses.find(
    (license) => license.purchasePlanId === purchasePlanId,
  );

  if (selected) {
    if (
      selected.subscription &&
      (selected.subscription.status === "ACTIVE" ||
        selected.subscription.status === "PAST_DUE") &&
      (selected.subscription.purchasePlanId === null ||
        selected.subscription.purchasePlanId === purchasePlanId)
    ) {
      return {
        mode: "RENEW",
        subscriptionId: selected.subscription.id,
      };
    }

    return {
      mode: "CONFLICT",
      reason: "ALREADY_OWNED",
    };
  }

  if (licenses.length > 0) {
    return {
      mode: "CONFLICT",
      reason: "PLAN_CHANGE_REQUIRED",
    };
  }

  return { mode: "NEW" };
}

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

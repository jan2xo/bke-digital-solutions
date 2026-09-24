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

function renewableOnPlan(
  purchasePlanId: string,
  license: SelfPurchaseLicenseFact,
): license is SelfPurchaseLicenseFact & {
  subscription: NonNullable<SelfPurchaseLicenseFact["subscription"]>;
} {
  return Boolean(
    license.purchasePlanId === purchasePlanId &&
      license.subscription &&
      (license.subscription.status === "ACTIVE" ||
        license.subscription.status === "PAST_DUE") &&
      license.subscription.purchasePlanId === purchasePlanId,
  );
}

export function decideSelfPurchaseContinuation(
  purchasePlanId: string,
  licenses: readonly SelfPurchaseLicenseFact[],
): SelfPurchaseContinuation {
  const renewable = licenses.find((license) =>
    renewableOnPlan(purchasePlanId, license),
  );
  if (renewable) {
    return {
      mode: "RENEW",
      subscriptionId: renewable.subscription.id,
    };
  }

  if (licenses.some((license) => license.purchasePlanId === purchasePlanId)) {
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

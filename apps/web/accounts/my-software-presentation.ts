/**
 * Web presentation projection only. Entitlement and seat authority remain with
 * Digital Solutions server-side account/entitlement capabilities.
 */
export type PlanType = "PERPETUAL" | "MONTHLY" | "SEMI_ANNUAL" | "ANNUAL" | null;

export type MySoftwareLicense = Readonly<{
  id: string;
  productName: string;
  editionName: string | null;
  planType: PlanType;
  status: string;
  subscriptionId: string | null;
  expiresAt: string | null;
  maxSeats: number;
  assignedSeats: number;
  maxDevices: number;
  activeDevices: number;
}>;

export type MySoftwareSubscription = Readonly<{
  id: string;
  productName: string;
  editionName: string | null;
  planType: PlanType;
  status: string;
  seats: number;
  currentPeriodEnd: string;
}>;

export type MySoftwareCard = MySoftwareLicense & Readonly<{
  subscription: MySoftwareSubscription | null;
  showRenewal: boolean;
  periodThrough: string | null;
}>;

export function planTypeLabel(type: PlanType): string {
  return type === "MONTHLY" ? "Monthly" : type === "SEMI_ANNUAL" ? "Semi-Annual" : type === "ANNUAL" ? "Annual"
    : type === "PERPETUAL" ? "Perpetual" : "Legacy plan";
}

export function buildMySoftwarePresentation(input: Readonly<{
  licenses: readonly MySoftwareLicense[];
  subscriptions: readonly MySoftwareSubscription[];
  canViewSubscriptions: boolean;
}>): Readonly<{
  cards: readonly MySoftwareCard[];
  unlinkedSubscriptions: readonly MySoftwareSubscription[];
}> {
  // A user with assigned-only license access must not receive billing metadata.
  const subscriptions = input.canViewSubscriptions ? input.subscriptions : [];
  const byId = new Map(subscriptions.map((item) => [item.id, item] as const));
  const represented = new Set<string>();
  const cards = input.licenses.map((license) => {
    const subscription = license.subscriptionId
      ? byId.get(license.subscriptionId) ?? null
      : null;
    const showRenewal = subscription !== null && !represented.has(subscription.id);
    if (subscription) represented.add(subscription.id);
    return Object.freeze({
      ...license,
      subscription,
      showRenewal,
      periodThrough: subscription?.currentPeriodEnd ?? license.expiresAt,
    });
  });
  return Object.freeze({
    cards: Object.freeze(cards),
    unlinkedSubscriptions: Object.freeze(subscriptions.filter((item) => !represented.has(item.id))),
  });
}

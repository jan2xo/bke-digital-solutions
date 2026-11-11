/**
 * Digital Solutions-only decision policy for a future signed account-product
 * execution lease. No signer, token, browser or product runtime is imported.
 *
 * Inputs are trusted transactional database evidence, NEVER request claims.
 * A "eligible" decision is not a signed lease or an authorization endpoint.
 */
export type ProductLeaseAction = "OPEN" | "USE";
export type ProductLeasePlan = "trial" | "subscription" | "perpetual";

export type ProductLeaseEvidence = Readonly<{
  entitlementId: string;
  entitlementStatus: string;
  entitlementValidFrom: Date;
  entitlementValidUntil: Date | null;
  /** True only for a matched commerce order item or claimed ClaimCode. */
  rightSourceVerified: boolean;
  licenseId: string;
  licenseStatus: string;
  licenseExpiresAt: Date | null;
  accountType: string;
  accountOwnerId: string;
  accountLifecycleState: string;
  licenseMaxSeats: number;
  seatAssigned: boolean;
  purchasePlanType: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  subscriptionPeriodStart: Date | null;
  subscriptionPeriodEnd: Date | null;
  trialId: string | null;
  trialStartsAt: Date | null;
  trialEndsAt: Date | null;
  trialRevokedAt: Date | null;
}>;

export type ProductLeaseEligibilityContext = Readonly<{
  sessionId: string;
  accountId: string;
  userId: string;
  productId: string;
  action: ProductLeaseAction;
  now: Date;
  productExists: boolean;
  productEntitled: boolean;
  productInstallable: boolean;
  productExecutionType: string | null;
}>;

export type ProductLeaseEligibilityDecision =
  | Readonly<{
      status: "eligible";
      sessionId: string;
      accountId: string;
      userId: string;
      productId: string;
      action: ProductLeaseAction;
      entitlementId: string;
      licenseId: string;
      plan: ProductLeasePlan;
      /** Maximum entitlement-derived horizon; NOT an issued JWS expiresAt. */
      rightsExpireNoLaterThan: Date | null;
    }>
  | Readonly<{ status: "denied"; reason: "NOT_ENTITLED" | "NO_ACTIVE_RIGHT" | "INVALID_CONTEXT" }>;

function liveDate(date: Date | null, now: number): date is Date {
  return date instanceof Date && Number.isFinite(date.getTime()) &&
    date.getTime() > now;
}

function capRightsExpiry(
  now: number,
  boundaries: readonly (Date | null)[],
): Date | null | undefined {
  let min: number | null = null;
  for (const boundary of boundaries) {
    if (boundary === null) continue;
    if (!liveDate(boundary, now)) return undefined;
    min = Math.min(min ?? boundary.getTime(), boundary.getTime());
  }
  return min === null ? null : new Date(min);
}

function eligibleRight(row: ProductLeaseEvidence, context: ProductLeaseEligibilityContext):
  | { plan: ProductLeasePlan; end: Date | null }
  | null {
  const now = context.now.getTime();
  if (!row.rightSourceVerified ||
      row.entitlementStatus !== "ACTIVE" ||
      row.licenseStatus !== "ACTIVE" ||
      row.accountLifecycleState !== "ACTIVE" ||
      row.licenseMaxSeats < 1 ||
      !Number.isSafeInteger(row.licenseMaxSeats) ||
      row.entitlementValidFrom.getTime() > now ||
      !Number.isFinite(row.entitlementValidFrom.getTime())) return null;

  if (row.accountType === "INDIVIDUAL") {
    if (row.accountOwnerId !== context.userId) return null;
  } else if (row.accountType === "ORGANIZATION") {
    if (!row.seatAssigned) return null;
  } else return null;

  let plan: ProductLeasePlan;
  const constraints: (Date | null)[] = [
    row.entitlementValidUntil,
    row.licenseExpiresAt,
  ];

  if (row.trialId !== null) {
    if (row.subscriptionId !== null ||
        row.trialRevokedAt !== null ||
        row.trialStartsAt === null ||
        row.trialEndsAt === null ||
        !Number.isFinite(row.trialStartsAt.getTime()) ||
        row.trialStartsAt.getTime() > now) return null;
    plan = "trial";
    constraints.push(row.trialEndsAt);
  } else if (row.subscriptionId !== null) {
    if (row.subscriptionStatus !== "ACTIVE" ||
        row.subscriptionPeriodStart === null ||
        row.subscriptionPeriodEnd === null ||
        !Number.isFinite(row.subscriptionPeriodStart.getTime()) ||
        row.subscriptionPeriodStart.getTime() > now ||
        row.purchasePlanType === "PERPETUAL") return null;
    plan = "subscription";
    constraints.push(row.subscriptionPeriodEnd);
  } else {
    // Never infer perpetual ownership from an old license with no plan.
    if (row.purchasePlanType !== "PERPETUAL") return null;
    plan = "perpetual";
  }

  const end = capRightsExpiry(now, constraints);
  return end === undefined ? null : { plan, end };
}

export function evaluateProductLeaseEligibility(
  context: ProductLeaseEligibilityContext,
  rows: readonly ProductLeaseEvidence[],
): ProductLeaseEligibilityDecision {
  if (!context.sessionId || !context.accountId || !context.userId ||
      !context.productId || !["OPEN", "USE"].includes(context.action) ||
      !(context.now instanceof Date) || !Number.isFinite(context.now.getTime()))
    return { status: "denied", reason: "INVALID_CONTEXT" };
  if (!context.productExists || !context.productEntitled ||
      !context.productInstallable ||
      !["STANDALONE", "LAUNCHER_PLUGIN"].includes(context.productExecutionType ?? ""))
    return { status: "denied", reason: "NOT_ENTITLED" };

  const viable = rows.flatMap(row => {
    const value = eligibleRight(row, context);
    return value ? [{ row, ...value }] : [];
  });
  if (viable.length === 0) return { status: "denied", reason: "NO_ACTIVE_RIGHT" };

  // Prefer the right with the longest independently verified remaining term.
  // Infinity (null) means a separate signed policy MUST bound the future JWS.
  viable.sort((left, right) =>
    (right.end?.getTime() ?? Infinity) - (left.end?.getTime() ?? Infinity) ||
    left.row.licenseId.localeCompare(right.row.licenseId) ||
    left.row.entitlementId.localeCompare(right.row.entitlementId));
  const selected = viable[0]!;
  return Object.freeze({
    status: "eligible" as const,
    sessionId: context.sessionId,
    accountId: context.accountId,
    userId: context.userId,
    productId: context.productId,
    action: context.action,
    entitlementId: selected.row.entitlementId,
    licenseId: selected.row.licenseId,
    plan: selected.plan,
    rightsExpireNoLaterThan: selected.end,
  });
}

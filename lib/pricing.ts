export const ANNUAL_DISCOUNT_MIN_BPS = 0;
export const ANNUAL_DISCOUNT_MAX_BPS = 1_000;
export const OFFER_DISCOUNT_MIN_BPS = 0;
export const OFFER_DISCOUNT_MAX_BPS = 10_000;
export const PRICING_VERSION = "OFFER_V1";

function assertMinorUnits(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`INVALID_${field}`);
}

export function roundRatioHalfUp(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n || numerator < 0n) throw new Error("INVALID_MONEY_RATIO");
  const rounded = (numerator + denominator / 2n) / denominator;
  const value = Number(rounded);
  if (!Number.isSafeInteger(value)) throw new Error("MONEY_OVERFLOW");
  return value;
}

export function calculatePlanMerchandising(listAmountMinor: number | null | undefined, amountMinor: number) {
  assertMinorUnits(amountMinor, "PLAN_AMOUNT");
  const list = listAmountMinor ?? amountMinor;
  assertMinorUnits(list, "PLAN_LIST_AMOUNT");
  if (list < amountMinor) throw new Error("INVALID_PLAN_LIST_AMOUNT");
  const savingsMinor = list - amountMinor;
  const discountBps = savingsMinor === 0 ? 0 : roundRatioHalfUp(BigInt(savingsMinor) * 10_000n, BigInt(list));
  return { listAmountMinor: list, amountMinor, savingsMinor, discountBps };
}

export function applyOfferDiscount(catalogAmountMinor: number, discountBps: number) {
  assertMinorUnits(catalogAmountMinor, "CATALOG_AMOUNT");
  if (!Number.isInteger(discountBps) || discountBps < OFFER_DISCOUNT_MIN_BPS || discountBps > OFFER_DISCOUNT_MAX_BPS) throw new Error("INVALID_OFFER_DISCOUNT");
  const finalAmountMinor = roundRatioHalfUp(BigInt(catalogAmountMinor) * BigInt(10_000 - discountBps), 10_000n);
  if (finalAmountMinor < 0 || finalAmountMinor > catalogAmountMinor) throw new Error("INVALID_DISCOUNTED_AMOUNT");
  return { catalogAmountMinor, discountBps, discountAmountMinor: catalogAmountMinor - finalAmountMinor, finalAmountMinor };
}

export type ResolvablePlan = {
  id: string;
  editionId?: string;
  type: "PERPETUAL" | "MONTHLY" | "ANNUAL";
  currency: string;
  amountMinor: number | null;
  listAmountMinor?: number | null;
  annualDiscountBps: number | null;
  renewalBehavior: "NONE" | "CUSTOMER_AUTHORIZED";
  monthlySource?: { amountMinor: number | null; active: boolean; type?: "PERPETUAL" | "MONTHLY" | "ANNUAL"; editionId?: string } | null;
};

export function resolvePurchasePlan(plan: ResolvablePlan) {
  if (plan.amountMinor === null) throw new Error("PLAN_AMOUNT_REQUIRED");
  assertMinorUnits(plan.amountMinor, "PLAN_AMOUNT");
  return {
    amountMinor: plan.amountMinor,
    intervalUnit: plan.type === "MONTHLY" ? "MONTH" as const : plan.type === "ANNUAL" ? "YEAR" as const : null,
    intervalCount: plan.type === "MONTHLY" || plan.type === "ANNUAL" ? 1 : null,
    billingType: plan.type === "PERPETUAL" ? "ONE_TIME" as const : "SUBSCRIPTION" as const,
    monthlyAmountMinor: plan.type === "MONTHLY" ? plan.amountMinor : null,
    discountBps: 0,
    grossAnnualMinor: null,
    annualAmountMinor: plan.type === "ANNUAL" ? plan.amountMinor : null,
    savingsMinor: calculatePlanMerchandising(plan.listAmountMinor, plan.amountMinor).savingsMinor,
    effectiveMonthlyMinor: plan.type === "ANNUAL" ? roundRatioHalfUp(BigInt(plan.amountMinor), 12n) : plan.type === "MONTHLY" ? plan.amountMinor : null,
  };
}

export function purchasePlanLabel(type: ResolvablePlan["type"]) {
  return type === "PERPETUAL" ? "Perpetual" : type === "MONTHLY" ? "Monthly" : "Annual";
}

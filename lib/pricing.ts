export const ANNUAL_DISCOUNT_MIN_BPS = 0;
export const ANNUAL_DISCOUNT_MAX_BPS = 1_000;

export type AnnualPricing = {
  monthlyAmountMinor: number;
  discountBps: number;
  grossAnnualMinor: number;
  annualAmountMinor: number;
  savingsMinor: number;
  effectiveMonthlyMinor: number;
};

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

export function calculateAnnualPricing(monthlyAmountMinor: number, discountBps: number): AnnualPricing {
  assertMinorUnits(monthlyAmountMinor, "MONTHLY_AMOUNT");
  if (!Number.isInteger(discountBps) || discountBps < ANNUAL_DISCOUNT_MIN_BPS || discountBps > ANNUAL_DISCOUNT_MAX_BPS) {
    throw new Error("INVALID_ANNUAL_DISCOUNT");
  }
  const grossAnnualMinor = monthlyAmountMinor * 12;
  if (!Number.isSafeInteger(grossAnnualMinor)) throw new Error("MONEY_OVERFLOW");
  const annualAmountMinor = roundRatioHalfUp(BigInt(grossAnnualMinor) * BigInt(10_000 - discountBps), 10_000n);
  return {
    monthlyAmountMinor,
    discountBps,
    grossAnnualMinor,
    annualAmountMinor,
    savingsMinor: grossAnnualMinor - annualAmountMinor,
    effectiveMonthlyMinor: roundRatioHalfUp(BigInt(annualAmountMinor), 12n),
  };
}

export type ResolvablePlan = {
  id: string;
  type: "PERPETUAL" | "MONTHLY" | "ANNUAL";
  currency: string;
  amountMinor: number | null;
  annualDiscountBps: number | null;
  renewalBehavior: "NONE" | "CUSTOMER_AUTHORIZED";
  monthlySource?: { amountMinor: number | null; active: boolean } | null;
};

export function resolvePurchasePlan(plan: ResolvablePlan) {
  if (plan.type === "ANNUAL") {
    if (!plan.monthlySource?.active || plan.monthlySource.amountMinor === null) throw new Error("ANNUAL_MONTHLY_PLAN_REQUIRED");
    const pricing = calculateAnnualPricing(plan.monthlySource.amountMinor, plan.annualDiscountBps ?? 0);
    return { ...pricing, amountMinor: pricing.annualAmountMinor, intervalUnit: "YEAR" as const, intervalCount: 1, billingType: "SUBSCRIPTION" as const };
  }
  if (plan.amountMinor === null) throw new Error("PLAN_AMOUNT_REQUIRED");
  assertMinorUnits(plan.amountMinor, "PLAN_AMOUNT");
  return {
    amountMinor: plan.amountMinor,
    intervalUnit: plan.type === "MONTHLY" ? "MONTH" as const : null,
    intervalCount: plan.type === "MONTHLY" ? 1 : null,
    billingType: plan.type === "PERPETUAL" ? "ONE_TIME" as const : "SUBSCRIPTION" as const,
    monthlyAmountMinor: plan.type === "MONTHLY" ? plan.amountMinor : null,
    discountBps: 0,
    grossAnnualMinor: null,
    annualAmountMinor: null,
    savingsMinor: 0,
    effectiveMonthlyMinor: plan.type === "MONTHLY" ? plan.amountMinor : null,
  };
}

export function purchasePlanLabel(type: ResolvablePlan["type"]) {
  return type === "PERPETUAL" ? "Perpetual" : type === "MONTHLY" ? "Monthly" : "Annual";
}

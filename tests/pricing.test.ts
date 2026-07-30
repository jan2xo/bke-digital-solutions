import { describe, expect, it } from "vitest";
import { calculateAnnualPricing, resolvePurchasePlan, roundRatioHalfUp } from "@/lib/pricing";

describe("purchase plan pricing", () => {
  it("calculates the documented ten-percent annual price in minor units", () => {
    expect(calculateAnnualPricing(49_900, 1_000)).toEqual({ monthlyAmountMinor: 49_900, discountBps: 1_000, grossAnnualMinor: 598_800, annualAmountMinor: 538_920, savingsMinor: 59_880, effectiveMonthlyMinor: 44_910 });
  });
  it("allows zero discount and rejects values outside zero to ten percent", () => {
    expect(calculateAnnualPricing(10_001, 0).annualAmountMinor).toBe(120_012);
    expect(() => calculateAnnualPricing(10_000, -1)).toThrow("INVALID_ANNUAL_DISCOUNT");
    expect(() => calculateAnnualPricing(10_000, 1_001)).toThrow("INVALID_ANNUAL_DISCOUNT");
  });
  it("rounds fractional minor units half up", () => {
    expect(roundRatioHalfUp(1n, 2n)).toBe(1);
    expect(roundRatioHalfUp(1n, 3n)).toBe(0);
    expect(calculateAnnualPricing(101, 333).annualAmountMinor).toBe(1_172);
  });
  it("requires an active monthly source for annual plans", () => {
    expect(() => resolvePurchasePlan({ id: "annual", type: "ANNUAL", currency: "PHP", amountMinor: null, annualDiscountBps: 500, renewalBehavior: "CUSTOMER_AUTHORIZED", monthlySource: null })).toThrow("ANNUAL_MONTHLY_PLAN_REQUIRED");
    expect(() => resolvePurchasePlan({ id: "annual", editionId: "edition-a", type: "ANNUAL", currency: "PHP", amountMinor: null, annualDiscountBps: 500, renewalBehavior: "CUSTOMER_AUTHORIZED", monthlySource: { type: "PERPETUAL", editionId: "edition-a", amountMinor: 1000, active: true } })).toThrow("ANNUAL_MONTHLY_PLAN_REQUIRED");
    expect(() => resolvePurchasePlan({ id: "annual", editionId: "edition-a", type: "ANNUAL", currency: "PHP", amountMinor: null, annualDiscountBps: 500, renewalBehavior: "CUSTOMER_AUTHORIZED", monthlySource: { type: "MONTHLY", editionId: "edition-b", amountMinor: 1000, active: true } })).toThrow("ANNUAL_MONTHLY_PLAN_REQUIRED");
  });
  it("normalizes perpetual and subscription terms without browser-provided totals", () => {
    expect(resolvePurchasePlan({ id: "p", type: "PERPETUAL", currency: "PHP", amountMinor: 9_999, annualDiscountBps: null, renewalBehavior: "NONE" })).toMatchObject({ amountMinor: 9_999, billingType: "ONE_TIME", intervalUnit: null });
    expect(resolvePurchasePlan({ id: "m", type: "MONTHLY", currency: "PHP", amountMinor: 499, annualDiscountBps: null, renewalBehavior: "CUSTOMER_AUTHORIZED" })).toMatchObject({ amountMinor: 499, billingType: "SUBSCRIPTION", intervalUnit: "MONTH" });
  });
});

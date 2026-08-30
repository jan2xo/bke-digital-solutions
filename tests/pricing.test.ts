import { describe, expect, it } from "vitest";
import { applyOfferDiscount, calculateAnnualPricing, resolvePurchasePlan, roundRatioHalfUp } from "@/lib/pricing";

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
  it("applies promotional discounts independently of annual catalog pricing", () => {
    expect(applyOfferDiscount(10_001, 0)).toMatchObject({ discountAmountMinor: 0, finalAmountMinor: 10_001 });
    expect(applyOfferDiscount(10_001, 5_000)).toMatchObject({ discountAmountMinor: 5_000, finalAmountMinor: 5_001 });
    expect(applyOfferDiscount(10_001, 10_000)).toMatchObject({ discountAmountMinor: 10_001, finalAmountMinor: 0 });
    const annual = calculateAnnualPricing(10_000, 1_000);
    expect(applyOfferDiscount(annual.annualAmountMinor, 2_500).finalAmountMinor).toBe(81_000);
    expect(() => applyOfferDiscount(10_000, 10_001)).toThrow("INVALID_OFFER_DISCOUNT");
  });
  it("keeps the Air Stack annual catalog saving separate from the 71-percent welcome offer", () => {
    const annual = calculateAnnualPricing(2_599_900, 500);
    expect(annual).toEqual({
      monthlyAmountMinor: 2_599_900,
      discountBps: 500,
      grossAnnualMinor: 31_198_800,
      annualAmountMinor: 29_638_860,
      savingsMinor: 1_559_940,
      effectiveMonthlyMinor: 2_469_905,
    });
    expect(applyOfferDiscount(annual.annualAmountMinor, 7_100)).toEqual({
      catalogAmountMinor: 29_638_860,
      discountBps: 7_100,
      discountAmountMinor: 21_043_591,
      finalAmountMinor: 8_595_269,
    });
  });
});

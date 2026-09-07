import { describe, expect, it } from "vitest";
import { applyOfferDiscount, calculateAnnualPricing, calculateSemiAnnualPricing, resolvePurchasePlan, resolveRenewalTermPricing, type ResolvablePlan } from "@/lib/pricing";
import { editionPlanSchema } from "@/lib/edition-plans";
import { checkoutSchema } from "@/lib/validation";
import { checkoutLegalTypes } from "@/lib/legal/service";
import { addMonths, addYears } from "@/lib/time";

const plan: ResolvablePlan = { id: "semi", editionId: "edition", type: "SEMI_ANNUAL", currency: "PHP", amountMinor: null, annualDiscountBps: null, semiAnnualDiscountBps: 500, renewalBehavior: "CUSTOMER_AUTHORIZED", monthlySource: { type: "MONTHLY", editionId: "edition", active: true, amountMinor: 10_000 } };
const edition = { name: "Fixture", slug: "fixture", maxUsers: 1, maxDevicesPerUser: 1, updatePolicy: "ACTIVE_TERM", plans: { perpetual: { enabled: false }, monthly: { enabled: true, amountMinor: 10_000 }, annual: { enabled: true, discountBps: 1_000 } } };
const saved = { pricingVersion: "OFFER_V1", planType: "SEMI_ANNUAL", currency: "PHP", monthlyBaseAmountMinor: 10_000, grossSemiAnnualAmountMinor: 60_000, semiAnnualCatalogDiscountBps: 500, semiAnnualCatalogDiscountMinor: 3_000, catalogAmountMinor: 57_000 };

describe("first-class six-month commercial terms (synthetic test rates)", () => {
  it("uses its own configured rate, six calendar months, and integer pricing", () => {
    expect(calculateSemiAnnualPricing(10_000, 500)).toEqual({ monthlyAmountMinor: 10_000, discountBps: 500, grossAmountMinor: 60_000, amountMinor: 57_000, savingsMinor: 3_000, effectiveMonthlyMinor: 9_500 });
    expect(resolvePurchasePlan(plan)).toMatchObject({ amountMinor: 57_000, billingType: "SUBSCRIPTION", intervalUnit: "MONTH", intervalCount: 6 });
    expect(resolvePurchasePlan({ ...plan, annualDiscountBps: 999 }).amountMinor).toBe(57_000);
    expect(calculateAnnualPricing(10_000, 1_000).annualAmountMinor).toBe(108_000);
    expect(applyOfferDiscount(57_000, 2_500)).toMatchObject({ discountAmountMinor: 14_250, finalAmountMinor: 42_750 });
  });

  it("allows an explicit zero-percent six-month discount", () => {
    expect(calculateSemiAnnualPricing(10_000, 0)).toEqual({ monthlyAmountMinor: 10_000, discountBps: 0, grossAmountMinor: 60_000, amountMinor: 60_000, savingsMinor: 0, effectiveMonthlyMinor: 10_000 });
    expect(resolvePurchasePlan({ ...plan, semiAnnualDiscountBps: 0 })).toMatchObject({ amountMinor: 60_000, discountBps: 0, savingsMinor: 0, intervalCount: 6 });
    const input = editionPlanSchema.parse({ ...edition, plans: { ...edition.plans, semiAnnual: { enabled: true, discountBps: 0 } } });
    expect(input.plans.semiAnnual).toEqual({ enabled: true, discountBps: 0 });
  });

  it("retains half-up rounding without one-cent disagreement", () => {
    expect(calculateSemiAnnualPricing(101, 333)).toMatchObject({ grossAmountMinor: 606, amountMinor: 586, savingsMinor: 20, effectiveMonthlyMinor: 98 });
    expect(calculateSemiAnnualPricing(125, 500)).toMatchObject({ grossAmountMinor: 750, amountMinor: 713, savingsMinor: 37, effectiveMonthlyMinor: 119 });
  });

  it.each([null, undefined])("never derives an unset rate from the annual rate: %s", (rate) => {
    expect(() => resolvePurchasePlan({ ...plan, annualDiscountBps: 1_000, semiAnnualDiscountBps: rate })).toThrow("SEMI_ANNUAL_DISCOUNT_REQUIRED");
  });
  it.each([-1, 1_001, 500.5, NaN, Infinity])("rejects invalid six-month discount %s", (rate) => {
    expect(() => calculateSemiAnnualPricing(10_000, rate)).toThrow("INVALID_SEMI_ANNUAL_DISCOUNT");
  });
  it("allows discounts whose monetary savings round to zero and fits every persisted amount in PostgreSQL Int", () => {
    expect(calculateSemiAnnualPricing(100, 1)).toMatchObject({ grossAmountMinor: 600, amountMinor: 600, savingsMinor: 0, effectiveMonthlyMinor: 100 });
    expect(calculateSemiAnnualPricing(357_913_941, 1_000).grossAmountMinor).toBe(2_147_483_646);
    expect(() => calculateSemiAnnualPricing(357_913_942, 1_000)).toThrow("MONEY_OVERFLOW");
  });
  it.each([null, { ...plan.monthlySource!, active: false }, { ...plan.monthlySource!, type: "ANNUAL" as const }, { ...plan.monthlySource!, editionId: "different" }])("requires an active monthly source from the same edition", (source) => {
    expect(() => resolvePurchasePlan({ ...plan, monthlySource: source })).toThrow("SEMI_ANNUAL_MONTHLY_PLAN_REQUIRED");
  });
  it("allows omitted or disabled configuration without inventing a value", () => {
    expect(editionPlanSchema.parse(edition).plans).not.toHaveProperty("semiAnnual");
    const input = editionPlanSchema.parse({ ...edition, plans: { ...edition.plans, semiAnnual: { enabled: false } } });
    expect(input.plans.semiAnnual).toEqual({ enabled: false });
  });
  it.each([{ enabled: true }, { enabled: true, discountBps: 1_001 }, { enabled: true, discountBps: 500, durationMonths: 7 }])("rejects missing or manipulated semi-annual configuration", (semiAnnual) => {
    expect(editionPlanSchema.safeParse({ ...edition, plans: { ...edition.plans, semiAnnual } }).success).toBe(false);
  });
  it("requires the monthly source and rejects six-month totals that exceed the database money limit", () => {
    expect(editionPlanSchema.safeParse({ ...edition, plans: { ...edition.plans, monthly: { enabled: false, amountMinor: 10_000 }, semiAnnual: { enabled: true, discountBps: 0 } } }).success).toBe(false);
    expect(editionPlanSchema.safeParse({ ...edition, plans: { ...edition.plans, monthly: { enabled: true, amountMinor: 100 }, semiAnnual: { enabled: true, discountBps: 1 } } }).success).toBe(true);
    expect(editionPlanSchema.safeParse({ ...edition, plans: { ...edition.plans, monthly: { enabled: true, amountMinor: 360_000_000 }, semiAnnual: { enabled: true, discountBps: 0 } } }).success).toBe(false);
  });

  it("uses only proven saved six-month breakdowns", () => {
    expect(resolveRenewalTermPricing("SEMI_ANNUAL", 57_000, "PHP", saved)).toMatchObject({ grossAmountMinor: 60_000, amountMinor: 57_000, savingsMinor: 3_000 });
    const zeroSaved = { ...saved, semiAnnualCatalogDiscountBps: 0, semiAnnualCatalogDiscountMinor: 0, catalogAmountMinor: 60_000 };
    expect(resolveRenewalTermPricing("SEMI_ANNUAL", 60_000, "PHP", zeroSaved)).toMatchObject({ grossAmountMinor: 60_000, amountMinor: 60_000, discountBps: 0, savingsMinor: 0 });
    for (const snapshot of [null, {}, { ...saved, currency: "USD" }, { ...saved, planType: "ANNUAL" }, { ...saved, pricingVersion: "UNKNOWN" }, { ...saved, semiAnnualCatalogDiscountMinor: 1 }, { ...saved, grossSemiAnnualAmountMinor: 1 }, { ...saved, semiAnnualCatalogDiscountBps: 750 }]) {
      expect(resolveRenewalTermPricing("SEMI_ANNUAL", 57_000, "PHP", snapshot)).toBeNull();
    }
    expect(resolveRenewalTermPricing("SEMI_ANNUAL", 42_750, "PHP", saved)).toBeNull();
  });

  it.each([0, 1, 2, 5, 6, 7, 11, 12, 13])("rejects browser-provided duration %s: only a plan ID is authoritative", (durationMonths) => {
    const input = { purchasePlanId: "cm00000000000000000000000", customerAccountId: "cm00000000000000000000001", legalVersionIds: ["cm00000000000000000000002", "cm00000000000000000000003"] };
    expect(checkoutSchema.safeParse(input).success).toBe(true);
    expect(checkoutSchema.safeParse({ ...input, durationMonths }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...input, amountMinor: 1, discountBps: 9_999 }).success).toBe(false);
  });

  it("uses subscription legal terms for six months", () => {
    expect(checkoutLegalTypes("SEMI_ANNUAL")).toEqual(checkoutLegalTypes("ANNUAL"));
    expect(checkoutLegalTypes("SEMI_ANNUAL")).toEqual(checkoutLegalTypes("MONTHLY"));
  });

  it("retains the existing UTC calendar overflow semantics", () => {
    expect(addMonths(new Date("2026-09-07T12:00:00Z"), 6).toISOString()).toBe("2027-03-07T12:00:00.000Z");
    expect(addMonths(new Date("2026-01-31T12:00:00Z"), 1).toISOString()).toBe("2026-03-03T12:00:00.000Z");
    expect(addMonths(new Date("2026-08-31T12:00:00Z"), 6).toISOString()).toBe("2027-03-03T12:00:00.000Z");
    expect(addYears(new Date("2024-02-29T12:00:00Z"), 1).toISOString()).toBe("2025-03-01T12:00:00.000Z");
  });
});

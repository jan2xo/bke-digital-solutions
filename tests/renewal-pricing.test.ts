import { describe, expect, it } from "vitest";
import { resolveAnnualRenewalPricing } from "@/lib/pricing";

const snapshot = { pricingVersion: "OFFER_V1", currency: "PHP", planType: "ANNUAL", monthlyBaseAmountMinor: 10_000, grossAnnualAmountMinor: 120_000, annualCatalogDiscountBps: 1_000, annualCatalogDiscountMinor: 12_000, catalogAmountMinor: 108_000, finalAmountMinor: 81_000 };

describe("historical annual invoice evidence", () => {
  it("uses the pre-promotion catalog amount and validates saved components", () => {
    expect(resolveAnnualRenewalPricing(108_000, "PHP", snapshot)).toMatchObject({ annualAmountMinor: 108_000, grossAnnualMinor: 120_000, savingsMinor: 12_000, discountBps: 1_000 });
    expect(resolveAnnualRenewalPricing(81_000, "PHP", snapshot)).toBeNull();
  });
  it.each([null, [], 1, {}, { ...snapshot, currency: "USD" }, { ...snapshot, pricingVersion: "unknown" }, { ...snapshot, planType: "MONTHLY" }, { ...snapshot, monthlyBaseAmountMinor: "10000" }, { ...snapshot, annualCatalogDiscountBps: 500 }, { ...snapshot, grossAnnualAmountMinor: 240_000 }, { ...snapshot, annualCatalogDiscountMinor: 1 }, { ...snapshot, catalogAmountMinor: 1 }])("rejects missing or inconsistent history: %j", (value) => {
    expect(resolveAnnualRenewalPricing(108_000, "PHP", value)).toBeNull();
  });
  it("preserves existing net-first half-up rounding at a half-cent boundary", () => {
    const saved = { ...snapshot, monthlyBaseAmountMinor: 125, grossAnnualAmountMinor: 1500, annualCatalogDiscountBps: 10, annualCatalogDiscountMinor: 1, catalogAmountMinor: 1499 };
    expect(resolveAnnualRenewalPricing(1499, "PHP", saved)).toMatchObject({ savingsMinor: 1, annualAmountMinor: 1499 });
  });
});

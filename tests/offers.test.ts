import { describe, expect, it } from "vitest";
import { assertOfferConfiguration } from "@/lib/offers";

describe("offer configuration", () => {
  it("allows a timed promotion at general, product, or edition scope", () => {
    expect(() => assertOfferConfiguration({ type: "GENERAL_PROMOTION", discountBps: 2_500, discountedBillingCycles: 12, purchasePlanType: null })).not.toThrow();
  });

  it("allows timed promotions on monthly plans and rejects non-monthly plans", () => {
    expect(() => assertOfferConfiguration({ type: "GENERAL_PROMOTION", discountBps: 2_500, discountedBillingCycles: 12, purchasePlanType: "MONTHLY" })).not.toThrow();
    expect(() => assertOfferConfiguration({ type: "GENERAL_PROMOTION", discountBps: 2_500, discountedBillingCycles: 12, purchasePlanType: "PERPETUAL" })).toThrow("INVALID_PROMOTIONAL_DURATION");
    expect(() => assertOfferConfiguration({ type: "GENERAL_PROMOTION", discountBps: 2_500, discountedBillingCycles: 12, purchasePlanType: "ANNUAL" })).toThrow("INVALID_PROMOTIONAL_DURATION");
  });
});

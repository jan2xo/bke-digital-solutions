import { describe, expect, it } from "vitest";
import { composeCapabilities } from "../../../platform/composition/composer";
import {
  COMMERCE_OFFER_REDEMPTION_CAPABILITY_ID,
  type CommerceOfferRedemptionCapability,
} from "../contracts/offer-redemption.contract";
import {
  COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID,
  type CommercePurchasePlanLookupCapability,
} from "../contracts/purchase-plan-lookup.contract";
import {
  COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  type CommercePurchasePlanPricingCapability,
} from "../contracts/purchase-plan-pricing.contract";
import { createCommerceModule } from "../module";

describe("Commerce module composition", () => {
  it("registers Commerce capabilities without touching persistence at startup", async () => {
    const application = await composeCapabilities([
      createCommerceModule({ connectionString: "postgresql://unused.invalid/commerce" }),
    ]);

    expect(application.moduleIds).toContain("commerce");
    expect(application.has(COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID)).toBe(true);
    expect(application.has(COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID)).toBe(true);
    expect(application.has(COMMERCE_OFFER_REDEMPTION_CAPABILITY_ID)).toBe(true);
    expect(
      typeof application.get<CommercePurchasePlanPricingCapability>(
        COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
      ).resolve,
    ).toBe("function");
    expect(
      typeof application.get<CommercePurchasePlanLookupCapability>(
        COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID,
      ).find,
    ).toBe("function");
    const offerRedemption = application.get<CommerceOfferRedemptionCapability>(
      COMMERCE_OFFER_REDEMPTION_CAPABILITY_ID,
    );
    expect(typeof offerRedemption.reserve).toBe("function");
    expect(typeof offerRedemption.transition).toBe("function");
  });
});

import { describe, expect, it } from "vitest";
import { composeCapabilities } from "../../../platform/composition/composer";
import {
  COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  type CommercePurchasePlanPricingCapability,
} from "../contracts/purchase-plan-pricing.contract";
import { commerceModule } from "../module";

describe("Commerce module composition", () => {
  it("registers purchase-plan pricing without persistence or external providers", async () => {
    const application = await composeCapabilities([commerceModule]);

    expect(application.moduleIds).toContain("commerce");
    expect(application.has(COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID)).toBe(true);
    expect(
      typeof application.get<CommercePurchasePlanPricingCapability>(
        COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
      ).resolve,
    ).toBe("function");
  });
});

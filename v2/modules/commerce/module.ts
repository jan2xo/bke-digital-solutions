import type { CapabilityModule } from "../../contracts/capability";
import {
  COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
} from "./contracts/purchase-plan-pricing.contract";
import { createCommercePurchasePlanPricingCapability } from "./logic/purchase-plan-pricing";
import { commerceModuleManifest } from "./module.manifest";

export const commerceModule: CapabilityModule = Object.freeze({
  manifest: commerceModuleManifest,
  start() {
    return [
      {
        id: COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
        value: createCommercePurchasePlanPricingCapability(),
      },
    ];
  },
});

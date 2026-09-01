import type { ModuleManifest } from "../../contracts/capability";
import { COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID } from "./contracts/purchase-plan-lookup.contract";
import { COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID } from "./contracts/purchase-plan-pricing.contract";

export const commerceModuleManifest = Object.freeze({
  moduleId: "commerce",
  needs: [],
  provides: [
    COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
    COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID,
  ],
} satisfies ModuleManifest);

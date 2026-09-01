import type { CapabilityModule } from "../../contracts/capability";
import { COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID } from "./contracts/purchase-plan-lookup.contract";
import { COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID } from "./contracts/purchase-plan-pricing.contract";
import { createCommercePurchasePlanLookupCapability } from "./logic/purchase-plan-lookup";
import { createCommercePurchasePlanPricingCapability } from "./logic/purchase-plan-pricing";
import { commerceModuleManifest } from "./module.manifest";
import { createPostgresCommercePurchasePlanLookupRepository } from "./prisma/repositories/postgres-purchase-plan-lookup-repository";

export interface CommerceModuleOptions {
  readonly connectionString: string;
}

export function createCommerceModule(options: CommerceModuleOptions): CapabilityModule {
  const purchasePlanLookup = createCommercePurchasePlanLookupCapability(
    createPostgresCommercePurchasePlanLookupRepository(options.connectionString),
  );
  const purchasePlanPricing = createCommercePurchasePlanPricingCapability();

  return Object.freeze({
    manifest: commerceModuleManifest,
    start() {
      return [
        {
          id: COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
          value: purchasePlanPricing,
        },
        {
          id: COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID,
          value: purchasePlanLookup,
        },
      ];
    },
  });
}

import type { CapabilityModule } from "../../contracts/capability";
import { COMMERCE_OFFER_REDEMPTION_CAPABILITY_ID } from "./contracts/offer-redemption.contract";
import { COMMERCE_ORDER_INVOICE_CREATION_CAPABILITY_ID } from "./contracts/order-invoice-creation.contract";
import { COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID } from "./contracts/purchase-plan-lookup.contract";
import { COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID } from "./contracts/purchase-plan-pricing.contract";
import { createCommerceOfferRedemptionCapability } from "./logic/offer-redemption";
import { createCommerceOrderInvoiceCreationCapability } from "./logic/order-invoice-creation";
import { createCommercePurchasePlanLookupCapability } from "./logic/purchase-plan-lookup";
import { createCommercePurchasePlanPricingCapability } from "./logic/purchase-plan-pricing";
import { commerceModuleManifest } from "./module.manifest";
import { createPostgresCommerceOfferRedemptionRepository } from "./prisma/repositories/postgres-offer-redemption-repository";
import { createPostgresCommerceOrderInvoiceCreationRepository } from "./prisma/repositories/postgres-order-invoice-creation-repository";
import { createPostgresCommercePurchasePlanLookupRepository } from "./prisma/repositories/postgres-purchase-plan-lookup-repository";

export interface CommerceModuleOptions {
  readonly connectionString: string;
}

export function createCommerceModule(options: CommerceModuleOptions): CapabilityModule {
  const offerRedemption = createCommerceOfferRedemptionCapability(
    createPostgresCommerceOfferRedemptionRepository(options.connectionString),
  );
  const orderInvoiceCreation = createCommerceOrderInvoiceCreationCapability(
    createPostgresCommerceOrderInvoiceCreationRepository(options.connectionString),
  );
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
        {
          id: COMMERCE_OFFER_REDEMPTION_CAPABILITY_ID,
          value: offerRedemption,
        },
        {
          id: COMMERCE_ORDER_INVOICE_CREATION_CAPABILITY_ID,
          value: orderInvoiceCreation,
        },
      ];
    },
  });
}

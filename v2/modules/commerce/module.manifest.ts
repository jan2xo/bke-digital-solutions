import { ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID } from "@bke/accounts/contracts/account-access.contract";
import { LEGAL_ACCEPTANCE_CAPABILITY_ID } from "@bke/legal/contracts/acceptance.contract";
import { PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID } from "@bke/payments/contracts/checkout-attempt.contract";
import type { ModuleManifest } from "../../contracts/capability";
import { COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID } from "./contracts/checkout-orchestration.contract";
import { COMMERCE_OFFER_REDEMPTION_CAPABILITY_ID } from "./contracts/offer-redemption.contract";
import { COMMERCE_ORDER_INVOICE_CREATION_CAPABILITY_ID } from "./contracts/order-invoice-creation.contract";
import { COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID } from "./contracts/purchase-plan-lookup.contract";
import { COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID } from "./contracts/purchase-plan-pricing.contract";

export const commerceModuleManifest = Object.freeze({
  moduleId: "commerce",
  needs: [
    ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
    LEGAL_ACCEPTANCE_CAPABILITY_ID,
    PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID,
  ],
  provides: [
    COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
    COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID,
    COMMERCE_OFFER_REDEMPTION_CAPABILITY_ID,
    COMMERCE_ORDER_INVOICE_CREATION_CAPABILITY_ID,
    COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID,
  ],
} satisfies ModuleManifest);

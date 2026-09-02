import {
  ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
  type AccountsAccountAccessCapability,
} from "@bke/accounts/contracts/account-access.contract";
import {
  LEGAL_ACCEPTANCE_CAPABILITY_ID,
  type LegalAcceptanceCapability,
} from "@bke/legal/contracts/acceptance.contract";
import {
  PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID,
  type PaymentsCheckoutAttemptCapability,
} from "@bke/payments/contracts/checkout-attempt.contract";
import { describe, expect, it } from "vitest";
import type { CapabilityModule } from "../../../contracts/capability";
import { composeCapabilities } from "../../../platform/composition/composer";
import {
  COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID,
  type CommerceCheckoutOrchestrationCapability,
} from "../contracts/checkout-orchestration.contract";
import {
  COMMERCE_OFFER_REDEMPTION_CAPABILITY_ID,
  type CommerceOfferRedemptionCapability,
} from "../contracts/offer-redemption.contract";
import {
  COMMERCE_ORDER_INVOICE_CREATION_CAPABILITY_ID,
  type CommerceOrderInvoiceCreationCapability,
} from "../contracts/order-invoice-creation.contract";
import {
  COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID,
  type CommercePurchasePlanLookupCapability,
} from "../contracts/purchase-plan-lookup.contract";
import {
  COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  type CommercePurchasePlanPricingCapability,
} from "../contracts/purchase-plan-pricing.contract";
import { createCommerceModule } from "../module";

const dependenciesModule: CapabilityModule = {
  manifest: {
    moduleId: "commerce-composition-dependencies",
    needs: [],
    provides: [
      ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
      LEGAL_ACCEPTANCE_CAPABILITY_ID,
      PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID,
    ],
  },
  start() {
    const accountAccess: AccountsAccountAccessCapability = {
      async authorize() {
        return { status: "REJECTED", code: "NOT_FOUND" };
      },
    };
    const legalAcceptance: LegalAcceptanceCapability = {
      async record() {
        return { status: "FAILED", code: "INVALID_INPUT" };
      },
      async check() {
        return { status: "NOT_ACCEPTED" };
      },
    };
    const paymentCheckout: PaymentsCheckoutAttemptCapability = {
      async create() {
        return { status: "FAILED", code: "INVALID_INPUT" };
      },
    };
    return [
      { id: ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID, value: accountAccess },
      { id: LEGAL_ACCEPTANCE_CAPABILITY_ID, value: legalAcceptance },
      { id: PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID, value: paymentCheckout },
    ];
  },
};

describe("Commerce module composition", () => {
  it("registers Commerce capabilities after declared checkout dependencies are available", async () => {
    const application = await composeCapabilities([
      createCommerceModule({ connectionString: "postgresql://unused.invalid/commerce" }),
      dependenciesModule,
    ]);

    expect(application.moduleIds).toContain("commerce");
    expect(application.has(COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID)).toBe(true);
    expect(application.has(COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID)).toBe(true);
    expect(application.has(COMMERCE_OFFER_REDEMPTION_CAPABILITY_ID)).toBe(true);
    expect(application.has(COMMERCE_ORDER_INVOICE_CREATION_CAPABILITY_ID)).toBe(true);
    expect(application.has(COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID)).toBe(true);
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
    expect(
      typeof application.get<CommerceOrderInvoiceCreationCapability>(
        COMMERCE_ORDER_INVOICE_CREATION_CAPABILITY_ID,
      ).create,
    ).toBe("function");
    expect(
      typeof application.get<CommerceCheckoutOrchestrationCapability>(
        COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID,
      ).start,
    ).toBe("function");
  });
});

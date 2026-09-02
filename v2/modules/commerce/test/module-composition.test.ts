import {
  ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
  type AccountsAccountAccessCapability,
} from "@bke/accounts/contracts/account-access.contract";
import {
  ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID,
  type EntitlementsDurableRightGrantCapability,
} from "@bke/entitlements/contracts/durable-right-grant.contract";
import {
  LEGAL_ACCEPTANCE_CAPABILITY_ID,
  type LegalAcceptanceCapability,
} from "@bke/legal/contracts/acceptance.contract";
import {
  PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID,
  type PaymentsCheckoutAttemptCapability,
} from "@bke/payments/contracts/checkout-attempt.contract";
import {
  PAYMENTS_SETTLEMENT_FACT_CAPABILITY_ID,
  type PaymentsSettlementFactCapability,
} from "@bke/payments/contracts/settlement-fact.contract";
import { describe, expect, it } from "vitest";
import type { CapabilityModule } from "../../../contracts/capability";
import { composeCapabilities } from "../../../platform/composition/composer";
import {
  COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID,
  type CommerceCheckoutOrchestrationCapability,
} from "../contracts/checkout-orchestration.contract";
import { COMMERCE_OFFER_REDEMPTION_CAPABILITY_ID } from "../contracts/offer-redemption.contract";
import { COMMERCE_ORDER_INVOICE_CREATION_CAPABILITY_ID } from "../contracts/order-invoice-creation.contract";
import { COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID } from "../contracts/purchase-plan-lookup.contract";
import { COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID } from "../contracts/purchase-plan-pricing.contract";
import {
  COMMERCE_SETTLEMENT_REACTION_CAPABILITY_ID,
  type CommerceSettlementReactionCapability,
} from "../contracts/settlement-reaction.contract";
import { createCommerceModule } from "../module";

const dependenciesModule: CapabilityModule = {
  manifest: {
    moduleId: "commerce-composition-dependencies",
    needs: [],
    provides: [
      ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
      LEGAL_ACCEPTANCE_CAPABILITY_ID,
      PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID,
      PAYMENTS_SETTLEMENT_FACT_CAPABILITY_ID,
      ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID,
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
    const paymentSettlement: PaymentsSettlementFactCapability = {
      async reconcile() {
        return { status: "REJECTED", code: "EVENT_NOT_FOUND" };
      },
    };
    const entitlementGrant: EntitlementsDurableRightGrantCapability = {
      async grant() {
        return { status: "FAILED", code: "INVALID_INPUT" };
      },
    };
    return [
      { id: ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID, value: accountAccess },
      { id: LEGAL_ACCEPTANCE_CAPABILITY_ID, value: legalAcceptance },
      { id: PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID, value: paymentCheckout },
      { id: PAYMENTS_SETTLEMENT_FACT_CAPABILITY_ID, value: paymentSettlement },
      { id: ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID, value: entitlementGrant },
    ];
  },
};

describe("Commerce module composition", () => {
  it("registers Commerce capabilities after declared checkout and settlement dependencies are available", async () => {
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
    expect(application.has(COMMERCE_SETTLEMENT_REACTION_CAPABILITY_ID)).toBe(true);
    expect(typeof application.get<CommerceCheckoutOrchestrationCapability>(COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID).start).toBe("function");
    expect(typeof application.get<CommerceSettlementReactionCapability>(COMMERCE_SETTLEMENT_REACTION_CAPABILITY_ID).react).toBe("function");
  });
});

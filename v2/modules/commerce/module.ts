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
import type { CapabilityModule, CapabilityResolver } from "../../contracts/capability";
import { COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID } from "./contracts/checkout-orchestration.contract";
import { COMMERCE_OFFER_REDEMPTION_CAPABILITY_ID } from "./contracts/offer-redemption.contract";
import { COMMERCE_ORDER_INVOICE_CREATION_CAPABILITY_ID } from "./contracts/order-invoice-creation.contract";
import { COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID } from "./contracts/purchase-plan-lookup.contract";
import { COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID } from "./contracts/purchase-plan-pricing.contract";
import { createCommerceCheckoutOrchestrationCapability } from "./logic/checkout-orchestration";
import type {
  CommerceAccountPurchaseAuthorizer,
  CommerceLegalAcceptanceChecker,
  CommercePaymentCheckoutStarter,
} from "./logic/checkout-orchestration-ports";
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
    start(resolver: CapabilityResolver) {
      const accountAccess = resolver.get<AccountsAccountAccessCapability>(
        ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
      );
      const legalAcceptance = resolver.get<LegalAcceptanceCapability>(
        LEGAL_ACCEPTANCE_CAPABILITY_ID,
      );
      const paymentCheckout = resolver.get<PaymentsCheckoutAttemptCapability>(
        PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID,
      );

      const accountAuthorizer: CommerceAccountPurchaseAuthorizer = {
        async authorize(input) {
          const result = await accountAccess.authorize({
            principalId: input.principalId,
            accountId: input.accountId,
            requiredCapability: "PURCHASE",
          });
          if (result.status === "AUTHORIZED") return { status: "AUTHORIZED" };
          if (result.status === "REJECTED") return { status: "REJECTED" };
          return { status: "FAILED" };
        },
      };

      const legalChecker: CommerceLegalAcceptanceChecker = {
        async check(input) {
          const result = await legalAcceptance.check({
            principalId: input.principalId,
            customerAccountId: input.accountId,
            documentId: input.requirement.documentId,
            documentVersionId: input.requirement.documentVersionId,
            acceptanceContext: input.requirement.acceptanceContext,
            slaVersion: input.requirement.slaVersion,
            renderedContentSha256: input.requirement.renderedContentSha256,
          });
          if (result.status === "ACCEPTED") return { status: "ACCEPTED" };
          if (result.status === "NOT_ACCEPTED") return { status: "NOT_ACCEPTED" };
          return { status: "FAILED" };
        },
      };

      const paymentStarter: CommercePaymentCheckoutStarter = {
        async create(input) {
          const result = await paymentCheckout.create(input);
          if (result.status === "READY") {
            return { status: "READY", value: result.value };
          }
          if (result.status === "REJECTED") return { status: "REJECTED" };
          return { status: "FAILED", code: result.code };
        },
      };

      const checkoutOrchestration = createCommerceCheckoutOrchestrationCapability({
        accountAuthorizer,
        legalChecker,
        orderInvoiceCreation,
        paymentStarter,
      });

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
        {
          id: COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID,
          value: checkoutOrchestration,
        },
      ];
    },
  });
}

import {
  ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
  type AccountsPurchaseAccessCapability,
} from "@bke/accounts/contracts/purchase-access.contract";
import { COMMERCE_CHECKOUT_OFFER_PRICING_CAPABILITY_ID } from "@bke/commerce/contracts/checkout-offer-pricing.contract";
import { COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID } from "@bke/commerce/contracts/checkout-orchestration.contract";
import { COMMERCE_OFFER_REDEMPTION_CAPABILITY_ID } from "@bke/commerce/contracts/offer-redemption.contract";
import { COMMERCE_ORDER_INVOICE_CREATION_CAPABILITY_ID } from "@bke/commerce/contracts/order-invoice-creation.contract";
import { COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID } from "@bke/commerce/contracts/purchase-plan-lookup.contract";
import { COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID } from "@bke/commerce/contracts/purchase-plan-pricing.contract";
import { COMMERCE_SETTLEMENT_REACTION_CAPABILITY_ID } from "@bke/commerce/contracts/settlement-reaction.contract";
import { COMMERCE_ZERO_PAYMENT_FULFILLMENT_CAPABILITY_ID } from "@bke/commerce/contracts/zero-payment-fulfillment.contract";
import { createCommerceCheckoutOfferPricingCapability } from "@bke/commerce/logic/checkout-offer-pricing";
import { createCommerceCheckoutOrchestrationCapability } from "@bke/commerce/logic/checkout-orchestration";
import type {
  CommerceAccountPurchaseAuthorizer,
  CommerceLegalAcceptanceChecker,
  CommercePaymentCheckoutStarter,
} from "@bke/commerce/logic/checkout-orchestration-ports";
import { createCommerceOfferRedemptionCapability } from "@bke/commerce/logic/offer-redemption";
import { createCommerceOrderInvoiceCreationCapability } from "@bke/commerce/logic/order-invoice-creation";
import { createCommercePurchasePlanLookupCapability } from "@bke/commerce/logic/purchase-plan-lookup";
import { createCommercePurchasePlanPricingCapability } from "@bke/commerce/logic/purchase-plan-pricing";
import { createCommerceSettlementReactionCapability } from "@bke/commerce/logic/settlement-reaction";
import type {
  CommerceEntitlementGranter,
  CommercePaymentsSettlementReconciler,
} from "@bke/commerce/logic/settlement-reaction-ports";
import { createCommerceZeroPaymentFulfillmentCapability } from "@bke/commerce/logic/zero-payment-fulfillment";
import { commerceModuleManifest } from "@bke/commerce/module.manifest";
import { createPostgresCommerceCheckoutOfferPricingRepository } from "@bke/commerce/prisma/repositories/postgres-checkout-offer-pricing-repository";
import { createPostgresCommerceOfferRedemptionRepository } from "@bke/commerce/prisma/repositories/postgres-offer-redemption-repository";
import { createPostgresCommerceOrderInvoiceCreationRepository } from "@bke/commerce/prisma/repositories/postgres-order-invoice-creation-repository";
import { createPostgresCommercePurchasePlanLookupRepository } from "@bke/commerce/prisma/repositories/postgres-purchase-plan-lookup-repository";
import { createPostgresCommerceSettlementReactionRepository } from "@bke/commerce/prisma/repositories/postgres-settlement-reaction-repository";
import { createPostgresCommerceZeroPaymentFulfillmentRepository } from "@bke/commerce/prisma/repositories/postgres-zero-payment-fulfillment-repository";
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
import type { CapabilityModule, CapabilityResolver } from "../../contracts/capability";

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
  const checkoutOfferPricing = createCommerceCheckoutOfferPricingCapability(
    createPostgresCommerceCheckoutOfferPricingRepository(options.connectionString),
  );
  const purchasePlanLookup = createCommercePurchasePlanLookupCapability(
    createPostgresCommercePurchasePlanLookupRepository(options.connectionString),
  );
  const purchasePlanPricing = createCommercePurchasePlanPricingCapability();
  const settlementRepository = createPostgresCommerceSettlementReactionRepository(
    options.connectionString,
  );
  const zeroPaymentRepository = createPostgresCommerceZeroPaymentFulfillmentRepository(
    options.connectionString,
  );

  const hostManifest = Object.freeze({
    ...commerceModuleManifest,
    needs: [
      ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
      LEGAL_ACCEPTANCE_CAPABILITY_ID,
      PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID,
      PAYMENTS_SETTLEMENT_FACT_CAPABILITY_ID,
      ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID,
    ],
  });

  return Object.freeze({
    manifest: hostManifest,
    start(resolver: CapabilityResolver) {
      const purchaseAccess = resolver.get<AccountsPurchaseAccessCapability>(
        ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
      );
      const legalAcceptance = resolver.get<LegalAcceptanceCapability>(
        LEGAL_ACCEPTANCE_CAPABILITY_ID,
      );
      const paymentCheckout = resolver.get<PaymentsCheckoutAttemptCapability>(
        PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID,
      );
      const paymentSettlement = resolver.get<PaymentsSettlementFactCapability>(
        PAYMENTS_SETTLEMENT_FACT_CAPABILITY_ID,
      );
      const entitlementGrant = resolver.get<EntitlementsDurableRightGrantCapability>(
        ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID,
      );

      const accountAuthorizer: CommerceAccountPurchaseAuthorizer = {
        async authorize(input) {
          const result = await purchaseAccess.authorize({
            principalId: input.principalId,
            accountId: input.accountId,
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
          if (result.status === "READY") return { status: "READY", value: result.value };
          if (result.status === "REJECTED") return { status: "REJECTED" };
          return { status: "FAILED", code: result.code };
        },
      };

      const entitlements: CommerceEntitlementGranter = {
        async grant(input) {
          const result = await entitlementGrant.grant(input);
          if (result.status === "GRANTED" || result.status === "EXISTING") {
            return { status: result.status };
          }
          if (result.status === "REJECTED") return { status: "REJECTED" };
          return { status: "FAILED" };
        },
      };

      const zeroPaymentFulfillment = createCommerceZeroPaymentFulfillmentCapability({
        repository: zeroPaymentRepository,
        entitlements,
      });

      const checkoutOrchestration = createCommerceCheckoutOrchestrationCapability({
        accountAuthorizer,
        legalChecker,
        orderInvoiceCreation,
        checkoutOfferPricing,
        zeroPaymentFulfillment,
        paymentStarter,
      });

      const payments: CommercePaymentsSettlementReconciler = {
        async reconcile(input) {
          const result = await paymentSettlement.reconcile(input);
          if (result.status === "SETTLED") return { status: "SETTLED", value: result.value };
          if (result.status === "REJECTED") return { status: "REJECTED" };
          return { status: "FAILED" };
        },
      };

      const settlementReaction = createCommerceSettlementReactionCapability({
        payments,
        repository: settlementRepository,
        entitlements,
      });

      return [
        { id: COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID, value: purchasePlanPricing },
        { id: COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID, value: purchasePlanLookup },
        { id: COMMERCE_OFFER_REDEMPTION_CAPABILITY_ID, value: offerRedemption },
        { id: COMMERCE_ORDER_INVOICE_CREATION_CAPABILITY_ID, value: orderInvoiceCreation },
        { id: COMMERCE_CHECKOUT_OFFER_PRICING_CAPABILITY_ID, value: checkoutOfferPricing },
        { id: COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID, value: checkoutOrchestration },
        { id: COMMERCE_SETTLEMENT_REACTION_CAPABILITY_ID, value: settlementReaction },
        { id: COMMERCE_ZERO_PAYMENT_FULFILLMENT_CAPABILITY_ID, value: zeroPaymentFulfillment },
      ];
    },
  });
}

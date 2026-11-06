import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { checkoutBinding, findBoundPaymentIntentOrderById, findPaymentIntentAttempt, isPaymentIntentCheckoutEnabled, mayResumePaymentIntentOrder, paymentIntentAttemptMatches, paymentIntentOrderMatches, paymentIntentRequestFingerprint, paymentIntentSourceReference } from "@/apps/web/commerce/payment-intent-checkout";
import { db } from "@/platform/host/db";
import {
  ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
  type AccountsPurchaseAccessCapability,
} from "@bke/accounts/contracts/purchase-access.contract";
import {
  CATALOG_LOOKUP_CAPABILITY_ID,
  type CatalogLookupCapability,
} from "@bke/catalog/contracts/catalog.contract";
import { COMMERCE_PAYMENT_INTENT_CHECKOUT_CAPABILITY_ID, type CommercePaymentIntentCheckoutCapability } from "@bke/commerce/contracts/payment-intent-checkout.contract";
import { COMMERCE_ORDER_SOURCE_LOOKUP_CAPABILITY_ID, type CommerceOrderSourceLookupCapability } from "@bke/commerce/contracts/order-source-lookup.contract";
import { PAYMENTS_PAYMENT_INTENT_CAPABILITY_ID, type PaymentsPaymentIntentCapability } from "@bke/payments/contracts/payment-intent.contract";
 
import {
  COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID,
  type CommerceCheckoutOrchestrationCapability,
} from "@bke/commerce/contracts/checkout-orchestration.contract";
import {
  COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID,
  type CommercePurchasePlanLookupCapability,
} from "@bke/commerce/contracts/purchase-plan-lookup.contract";
import {
  COMMERCE_PRICING_VERSION,
  COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  type CommercePurchasePlanPricingCapability,
} from "@bke/commerce/contracts/purchase-plan-pricing.contract";
import {
  LEGAL_ACCEPTANCE_CAPABILITY_ID,
  type LegalAcceptanceCapability,
} from "@bke/legal/contracts/acceptance.contract";
import {
  LEGAL_CHECKOUT_REQUIREMENTS_CAPABILITY_ID,
  type LegalCheckoutRequirementsCapability,
} from "@bke/legal/contracts/checkout-requirements.contract";
import {
  LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID,
  type LegalReacceptanceStatusCapability,
} from "@bke/legal/contracts/reacceptance-status.contract";
import { NextResponse } from "next/server";
import { requireIdentityUser } from "@/apps/web/auth/session";
import { apiError } from "@/apps/web/http/api-error";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/apps/web/http/request";
import { checkoutSchema } from "@/apps/web/http/validation";
import { getV2WebApplication } from "@/apps/web/runtime";
import { resolveSelfPurchaseContinuation } from "@/apps/web/licensing/self-purchase-continuation";
import { getRuntimeEnvironment } from "@/platform/host/env";

class CheckoutHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

function fail(code: string, status: number): never {
  throw new CheckoutHttpError(code, status);
}

function requiredHostFact(name: "APP_URL" | "SUPPORT_EMAIL" | "BUSINESS_ADDRESS"): string {
  const value = process.env[name]?.trim();
  if (!value) fail("CHECKOUT_HOST_CONFIGURATION_UNAVAILABLE", 503);
  return value;
}

function planLabel(type: "PERPETUAL" | "MONTHLY" | "ANNUAL"): string {
  return type === "PERPETUAL" ? "Perpetual" : type === "MONTHLY" ? "Monthly" : "Annual";
}

function commerceFailure(code: string): never {
  switch (code) {
    case "ACCOUNT_FORBIDDEN":
      return fail("FORBIDDEN", 403);
    case "LEGAL_NOT_ACCEPTED":
      return fail("LEGAL_ACCEPTANCE_REQUIRED", 409);
    case "PAYMENT_INTENT_IN_PROGRESS":
      return fail("PAYMENT_REQUEST_IN_PROGRESS", 409);
    case "PAYMENT_INTENT_RECOVERY_REQUIRED":
      return fail("PAYMENT_RECOVERY_REQUIRED", 409);
    case "PAYMENT_INTENT_MISMATCH":
      return fail("CHECKOUT_REQUEST_MISMATCH", 409);
    case "PAYMENT_INTENT_MODE_MISMATCH":
    case "PAYMENT_INTENT_CREATION_DISABLED":
      return fail("PAYMENT_INTENT_DISABLED", 503);
    case "PAYMENT_INTENT_PERSISTENCE_UNAVAILABLE":
      return fail("COMMERCE_UNAVAILABLE", 503);
    case "PAYMENT_INTENT_PROVIDER_UNAVAILABLE":
      return fail("PAYMENT_PROVIDER_UNAVAILABLE", 503);
    case "PAYMENT_INTENT_PROVIDER_REJECTED":
      return fail("PAYMENT_PROVIDER_REJECTED", 502);
    case "ORDER_CONFLICT":
    case "PAYMENT_SOURCE_CONFLICT":
      return fail("CHECKOUT_CREATION_IN_PROGRESS", 409);
    case "OFFER_NOT_AVAILABLE":
      return fail("OFFER_NOT_AVAILABLE", 422);
    case "ENTITLEMENT_CONFLICT":
      return fail("ENTITLEMENT_CONFLICT", 409);
    case "CLAIM_UNIT_CONFLICT":
      return fail("CLAIM_UNIT_CONFLICT", 409);
    case "PAYMENT_PROVIDER_REJECTED":
      return fail("PAYMENT_PROVIDER_REJECTED", 502);
    case "INVALID_INPUT":
      return fail("INVALID_CHECKOUT", 422);
    case "ACCOUNT_UNAVAILABLE":
    case "LEGAL_UNAVAILABLE":
    case "COMMERCE_PERSISTENCE_UNAVAILABLE":
    case "ENTITLEMENTS_UNAVAILABLE":
    case "CLAIM_UNITS_UNAVAILABLE":
    case "PAYMENTS_UNAVAILABLE":
    case "PAYMENT_PROVIDER_UNAVAILABLE":
      return fail(code, 503);
    default:
      return fail("CHECKOUT_FAILED", 503);
  }
}

export async function POST(request: Request) {
  let recoverableOrderId: string | null = null;
  let privateResponse = process.env.PROVIDER_CONFIG_SOURCE !== "database" &&
    isPaymentIntentCheckoutEnabled(process.env.PAYMENT_PROVIDER, process.env.PAYMONGO_PUBLIC_KEY);
  try {
    assertSameOrigin(request);

    const principal = await requireIdentityUser();
    if (!principal.emailVerified) fail("EMAIL_NOT_VERIFIED", 403);

    const application = await getV2WebApplication();
    const reacceptance = application.get<LegalReacceptanceStatusCapability>(
      LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID,
    );
    const reacceptanceStatus = await reacceptance.check({
      principalId: principal.id,
      principalEstablishedAt: principal.establishedAt,
    });
    if (reacceptanceStatus.status === "REACCEPTANCE_REQUIRED") {
      fail("LEGAL_REACCEPTANCE_REQUIRED", 409);
    }
    if (reacceptanceStatus.status === "FAILED") {
      fail(
        reacceptanceStatus.code === "PERSISTENCE_UNAVAILABLE"
          ? "LEGAL_DOCUMENTS_UNAVAILABLE"
          : "INVALID_CHECKOUT",
        reacceptanceStatus.code === "PERSISTENCE_UNAVAILABLE" ? 503 : 422,
      );
    }

    const ipAddress = clientIp(request);
    if (!(await rateLimit(`checkout:${principal.id}:${ipAddress}`, 10, 3600)).allowed) {
      fail("RATE_LIMITED", 429);
    }

    const input = checkoutSchema.parse(await request.json());
    const runtimeEnvironment = getRuntimeEnvironment();
    const paymentIntentEnabled = runtimeEnvironment.PROVIDER_CONFIG_SOURCE === "environment" &&
      isPaymentIntentCheckoutEnabled(runtimeEnvironment.PAYMENT_PROVIDER, runtimeEnvironment.PAYMONGO_PUBLIC_KEY);
    privateResponse = paymentIntentEnabled;
    if (paymentIntentEnabled && !input.paymentIntentNonce) fail("INVALID_CHECKOUT", 422);
    const usePaymentIntent = paymentIntentEnabled && Boolean(input.paymentIntentNonce);
    const giftPurchase = input.purchaseFor === "GIFT";
    const purchaseAccess = application.get<AccountsPurchaseAccessCapability>(
      ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
    );
    const access = await purchaseAccess.authorize({
      principalId: principal.id,
      accountId: input.customerAccountId,
    });
    if (access.status === "REJECTED") {
      fail(access.code, access.code === "NOT_FOUND" ? 404 : 403);
    }
    if (access.status === "FAILED") {
      fail(access.code === "PERSISTENCE_UNAVAILABLE" ? "ACCOUNT_UNAVAILABLE" : "INVALID_CHECKOUT", 503);
    }

    if (usePaymentIntent && input.paymentIntentNonce) {
      const sourceReference = paymentIntentSourceReference(principal.id, access.account.id, input.paymentIntentNonce);
      const lookup = application.get<CommerceOrderSourceLookupCapability>(COMMERCE_ORDER_SOURCE_LOOKUP_CAPABILITY_ID);
      const found = await lookup.find({ sourceReference });
      if (found.status === "FAILED") fail("COMMERCE_UNAVAILABLE", 503);
      if (found.status === "FOUND") {
        const prior = await findBoundPaymentIntentOrderById(found.value.orderId);
        const fingerprint = paymentIntentRequestFingerprint({
          principalId: principal.id, accountId: access.account.id, purchasePlanId: input.purchasePlanId,
          offerIdentifier: input.offerIdentifier ?? null, purchaseFor: input.purchaseFor,
        });
        if (!prior || prior.accountId !== found.value.accountId || prior.totalMinor !== found.value.totalMinor || prior.currency !== found.value.currency ||
          !paymentIntentOrderMatches(prior, {
            principalId: principal.id, accountId: access.account.id, sourceReference, requestFingerprint: fingerprint,
            purchasePlanId: input.purchasePlanId, offerIdentifier: input.offerIdentifier ?? null, purchaseFor: input.purchaseFor,
          })) fail("CHECKOUT_REQUEST_MISMATCH", 409);
        recoverableOrderId = prior.id;
        const saved = checkoutBinding(prior);
        if (!saved) fail("PAYMENT_RECOVERY_REQUIRED", 409);
        const planType = saved.planType;
        if (planType !== "PERPETUAL" && planType !== "MONTHLY" && planType !== "ANNUAL") fail("PAYMENT_RECOVERY_REQUIRED", 409);
        const savedRenewalId = typeof saved.renewalSubscriptionId === "string" ? saved.renewalSubscriptionId : null;
        const legalContext = savedRenewalId ? "RENEWAL_CHECKOUT" : "CHECKOUT";
        const requirementsCapability = application.get<LegalCheckoutRequirementsCapability>(LEGAL_CHECKOUT_REQUIREMENTS_CAPABILITY_ID);
        const requirementsResult = await requirementsCapability.resolve({
          planType,
          selectedVersionIds: input.legalVersionIds,
          variables: {
            company_name: "BKE Digital Solutions",
            support_email: requiredHostFact("SUPPORT_EMAIL"),
            website: requiredHostFact("APP_URL"),
            business_address: requiredHostFact("BUSINESS_ADDRESS"),
          },
        });
        if (requirementsResult.status === "REJECTED") fail(requirementsResult.code, 409);
        if (requirementsResult.status === "FAILED") fail("LEGAL_DOCUMENTS_UNAVAILABLE", 503);
        const acceptance = application.get<LegalAcceptanceCapability>(LEGAL_ACCEPTANCE_CAPABILITY_ID);
        const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
        for (const requirement of requirementsResult.requirements) {
          const recorded = await acceptance.record({
            principalId: principal.id, customerAccountId: access.account.id,
            documentId: requirement.documentId, documentVersionId: requirement.documentVersionId,
            acceptanceContext: legalContext, slaVersion: requirement.slaVersion,
            renderedContentSha256: requirement.renderedContentSha256,
            variablesSnapshot: requirement.variablesSnapshot, ipAddress: ipAddress.slice(0, 128), userAgent,
          });
          if (recorded.status === "REJECTED") fail("LEGAL_ACCEPTANCE_REQUIRED", 409);
          if (recorded.status === "FAILED") fail("LEGAL_DOCUMENTS_UNAVAILABLE", 503);
        }
        if (prior.status === "PAID") {
          return NextResponse.json({
            orderId: prior.id, checkoutUrl: `/checkout/success?orderId=${encodeURIComponent(prior.id)}`,
            paymentConfirmed: true,
          }, { headers: { "Cache-Control": "private, no-store" } });
        }
        if (!mayResumePaymentIntentOrder(prior.status)) fail("PAYMENT_RECOVERY_REQUIRED", 409);
        if (prior.totalMinor <= 0) fail("PAYMENT_RECOVERY_REQUIRED", 409);
        const durableAttempt = await findPaymentIntentAttempt(sourceReference);
        if (!durableAttempt) fail("PAYMENT_RECOVERY_REQUIRED", 409);
        if (!paymentIntentAttemptMatches(durableAttempt, {
          sourceReference, commercialReference: prior.id, provider: "paymongo",
          livemode: runtimeEnvironment.PAYMONGO_LIVEMODE, amountMinor: prior.totalMinor, currency: prior.currency,
        })) {
          fail("CHECKOUT_REQUEST_MISMATCH", 409);
        }
        const payments = application.get<PaymentsPaymentIntentCapability>(PAYMENTS_PAYMENT_INTENT_CAPABILITY_ID);
        const resumed = await payments.create({
          sourceReference, commercialReference: prior.id, amountMinor: prior.totalMinor,
          currency: prior.currency, livemode: runtimeEnvironment.PAYMONGO_LIVEMODE,
          paymentMethodAllowed: ["qrph"],
        });
        if (resumed.status !== "READY") fail(resumed.status === "FAILED" && resumed.code === "REQUEST_IN_PROGRESS" ? "PAYMENT_REQUEST_IN_PROGRESS" : "PAYMENT_RECOVERY_REQUIRED", 409);
        const intent = resumed.value;
        if (intent.status === "awaiting_payment_method") {
          const method = await payments.createPaymentMethod({ attemptId: intent.attemptId, type: "qrph" });
          if (method.status !== "CREATED") fail("PAYMENT_RECOVERY_REQUIRED", 409);
          const attached = await payments.attachPaymentMethod({ attemptId: intent.attemptId, paymentMethodId: method.value.paymentMethodId, clientKey: intent.clientKey });
          if (attached.status !== "ATTACHED") fail("PAYMENT_RECOVERY_REQUIRED", 409);
          return NextResponse.json({ orderId: prior.id, paymentIntent: { status: attached.value.status === "succeeded" ? "confirming" : attached.value.status, amountMinor: intent.amountMinor, currency: intent.currency, ...(attached.value.qrImageUrl ? { qrImageUrl: attached.value.qrImageUrl } : {}), ...(attached.value.expiresAt ? { expiresAt: attached.value.expiresAt } : {}) } }, { headers: { "Cache-Control": "private, no-store" } });
        }
        return NextResponse.json({ orderId: prior.id, paymentIntent: { status: intent.status === "succeeded" ? "confirming" : intent.status, amountMinor: prior.totalMinor, currency: prior.currency, ...(intent.qrImageUrl ? { qrImageUrl: intent.qrImageUrl } : {}), ...(intent.expiresAt ? { expiresAt: intent.expiresAt } : {}) } }, { headers: { "Cache-Control": "private, no-store" } });
      }
    }

    if (giftPurchase && !runtimeEnvironment.CLAIM_CODE_CHECKOUT_ENABLED) {
      fail("GIFT_CHECKOUT_DISABLED", 409);
    }

    const planLookup = application.get<CommercePurchasePlanLookupCapability>(
      COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID,
    );
    const planResult = await planLookup.find({ planId: input.purchasePlanId });
    if (planResult.status === "NOT_FOUND" || (planResult.status === "FOUND" && !planResult.plan.active)) {
      fail("INVALID_PURCHASE_PLAN", 422);
    }
    if (planResult.status === "FAILED") {
      fail(planResult.code === "PERSISTENCE_UNAVAILABLE" ? "COMMERCE_UNAVAILABLE" : "INVALID_PURCHASE_PLAN", planResult.code === "PERSISTENCE_UNAVAILABLE" ? 503 : 422);
    }
    const plan = planResult.plan;
    if (!plan.editionId) fail("INVALID_PURCHASE_PLAN", 422);

    const pricingCapability = application.get<CommercePurchasePlanPricingCapability>(
      COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
    );
    const pricingResult = pricingCapability.resolve(plan);
    if (pricingResult.status === "FAILED") fail(pricingResult.code, 422);
    const pricing = pricingResult.pricing;

    const catalog = application.get<CatalogLookupCapability>(CATALOG_LOOKUP_CAPABILITY_ID);
    const editionResult = await catalog.findEditionById(plan.editionId);
    if (editionResult.status === "NOT_FOUND" || (editionResult.status === "FOUND" && !editionResult.value.active)) {
      fail("INVALID_CATALOG_EDITION", 422);
    }
    if (editionResult.status === "FAILED") {
      fail(editionResult.code === "PERSISTENCE_UNAVAILABLE" ? "CATALOG_UNAVAILABLE" : "INVALID_CATALOG_EDITION", editionResult.code === "PERSISTENCE_UNAVAILABLE" ? 503 : 422);
    }
    const edition = editionResult.value;

    const productResult = await catalog.findProductById(edition.productId);
    if (
      productResult.status === "NOT_FOUND" ||
      (productResult.status === "FOUND" &&
        (!productResult.value.active || productResult.value.archivedAt !== null || !productResult.value.available))
    ) {
      fail("INVALID_CATALOG_PRODUCT", 422);
    }
    if (productResult.status === "FAILED") {
      fail(productResult.code === "PERSISTENCE_UNAVAILABLE" ? "CATALOG_UNAVAILABLE" : "INVALID_CATALOG_PRODUCT", productResult.code === "PERSISTENCE_UNAVAILABLE" ? 503 : 422);
    }
    const product = productResult.value;

    const selfPurchase = giftPurchase
      ? ({ mode: "NEW" } as const)
      : await resolveSelfPurchaseContinuation({
          accountId: access.account.id,
          editionId: edition.id,
          purchasePlanId: plan.id,
        });
    if (selfPurchase.mode === "CONFLICT") {
      fail("ENTITLEMENT_CONFLICT", 409);
    }
    const renewalSubscriptionId =
      selfPurchase.mode === "RENEW" ? selfPurchase.subscriptionId : null;
    const acceptanceContext: "CHECKOUT" | "RENEWAL_CHECKOUT" =
      renewalSubscriptionId ? "RENEWAL_CHECKOUT" : "CHECKOUT";

    const requirementsCapability = application.get<LegalCheckoutRequirementsCapability>(
      LEGAL_CHECKOUT_REQUIREMENTS_CAPABILITY_ID,
    );
    const requirementsResult = await requirementsCapability.resolve({
      planType: plan.type,
      selectedVersionIds: input.legalVersionIds,
      variables: {
        company_name: "BKE Digital Solutions",
        support_email: requiredHostFact("SUPPORT_EMAIL"),
        website: requiredHostFact("APP_URL"),
        business_address: requiredHostFact("BUSINESS_ADDRESS"),
      },
    });
    if (requirementsResult.status === "REJECTED") fail(requirementsResult.code, 409);
    if (requirementsResult.status === "FAILED") {
      fail(
        requirementsResult.code === "PERSISTENCE_UNAVAILABLE" ||
          requirementsResult.code === "LEGAL_DOCUMENTS_UNAVAILABLE"
          ? "LEGAL_DOCUMENTS_UNAVAILABLE"
          : "INVALID_CHECKOUT",
        requirementsResult.code === "PERSISTENCE_UNAVAILABLE" ||
          requirementsResult.code === "LEGAL_DOCUMENTS_UNAVAILABLE"
          ? 503
          : 422,
      );
    }
    const requirements = requirementsResult.requirements;

    const acceptance = application.get<LegalAcceptanceCapability>(LEGAL_ACCEPTANCE_CAPABILITY_ID);
    const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
    for (const requirement of requirements) {
      const recorded = await acceptance.record({
        principalId: principal.id,
        customerAccountId: access.account.id,
        documentId: requirement.documentId,
        documentVersionId: requirement.documentVersionId,
        acceptanceContext,
        slaVersion: requirement.slaVersion,
        renderedContentSha256: requirement.renderedContentSha256,
        variablesSnapshot: requirement.variablesSnapshot,
        ipAddress: ipAddress.slice(0, 128),
        userAgent,
      });
      if (recorded.status === "REJECTED") fail("LEGAL_ACCEPTANCE_REQUIRED", 409);
      if (recorded.status === "FAILED") {
        fail(recorded.code === "PERSISTENCE_UNAVAILABLE" ? "LEGAL_DOCUMENTS_UNAVAILABLE" : "INVALID_CHECKOUT", recorded.code === "PERSISTENCE_UNAVAILABLE" ? 503 : 422);
      }
    }

    const name = planLabel(plan.type);
    const suffix = `${Date.now().toString(36).toUpperCase()}${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const pricingSnapshot = {
      pricingVersion: COMMERCE_PRICING_VERSION,
      currency: plan.currency,
      planType: plan.type,
      purchasePlanAmountMinor: plan.amountMinor,
      catalogAmountMinor: pricing.amountMinor,
      finalAmountMinor: pricing.amountMinor,
      ...(plan.type === "ANNUAL"
        ? {
            monthlyBaseAmountMinor: pricing.monthlyAmountMinor,
            grossAnnualAmountMinor: pricing.grossAnnualMinor,
            annualCatalogDiscountBps: pricing.discountBps,
            annualCatalogDiscountMinor: pricing.savingsMinor,
          }
        : {}),
    };
    const entitlementSnapshot = {
      editionName: edition.name,
      features: edition.features,
      maxUsers: edition.maxUsers,
      maxDevicesPerUser: edition.maxDevicesPerUser,
      updatePolicy: edition.updatePolicy,
      planType: plan.type,
      renewalBehavior: plan.renewalBehavior,
      intervalUnit: pricing.intervalUnit,
      intervalCount: pricing.intervalCount,
      annualDiscountBps: plan.annualDiscountBps,
    };

    const fulfillmentMode: "CLAIM_CODE" | "ACCOUNT_ENTITLEMENT" = giftPurchase ? "CLAIM_CODE" : "ACCOUNT_ENTITLEMENT";
    const sourceReference = usePaymentIntent && input.paymentIntentNonce
      ? paymentIntentSourceReference(principal.id, access.account.id, input.paymentIntentNonce)
      : `checkout:${principal.id}:${randomUUID()}`;
    const checkoutInput = {
      principalId: principal.id,
      accountId: access.account.id,
      legal: requirements.map((requirement) => ({
        documentId: requirement.documentId,
        documentVersionId: requirement.documentVersionId,
        acceptanceContext,
        slaVersion: requirement.slaVersion,
        renderedContentSha256: requirement.renderedContentSha256,
      })),
      order: {
        accountId: access.account.id,
        ...(renewalSubscriptionId ? { renewalSubscriptionId } : {}),
        sourceReference,
        fulfillmentMode,
        fulfillmentSnapshot: usePaymentIntent && input.paymentIntentNonce ? { checkoutBinding: { principalId: principal.id, accountId: access.account.id, nonceHash: paymentIntentSourceReference(principal.id, access.account.id, input.paymentIntentNonce).slice("checkout:pi:".length), purchasePlanId: plan.id, offerIdentifier: input.offerIdentifier ?? null, purchaseFor: input.purchaseFor, renewalSubscriptionId, requestFingerprint: paymentIntentRequestFingerprint({ principalId: principal.id, accountId: access.account.id, purchasePlanId: plan.id, offerIdentifier: input.offerIdentifier ?? null, purchaseFor: input.purchaseFor }), sourceReference, planType: plan.type, currency: plan.currency, fulfillmentMode: giftPurchase ? "CLAIM_CODE" : "ACCOUNT_ENTITLEMENT", lines: [{ productId: product.id, priceId: plan.id, policyId: edition.id, quantity: 1, purchasePlanId: plan.id, planType: plan.type }] } } : {},
        orderNumber: `BKE-${new Date().getUTCFullYear()}-${suffix}`,
        invoiceNumber: `INV-${new Date().getUTCFullYear()}-${suffix}`,
        currency: plan.currency,
        taxMinor: 0,
        billingSnapshot: {
          name: access.account.displayName,
          email: access.account.billingEmail,
        },
        customerSnapshot: {
          name: access.account.displayName,
          email: access.account.billingEmail,
        },
        lines: [
          {
            productId: product.id,
            priceId: plan.id,
            policyId: edition.id,
            productName: product.name,
            priceName: `${edition.name} — ${name}`,
            description: `${name}; ${plan.renewalBehavior === "NONE" ? "no renewal" : "customer-authorized renewal"}`,
            quantity: 1,
            unitAmountMinor: pricing.amountMinor,
            billingType: pricing.billingType,
            policySnapshot: {
              maxSeats: edition.maxUsers,
              maxDevicesPerSeat: edition.maxDevicesPerUser,
            },
            editionId: edition.id,
            purchasePlanId: plan.id,
            planName: name,
            planType: plan.type,
            intervalUnit: pricing.intervalUnit,
            intervalCount: pricing.intervalCount,
            renewalBehavior: plan.renewalBehavior,
            entitlementSnapshot,
            pricingSnapshot,
            catalogAmountMinor: pricing.amountMinor,
            pricingVersion: COMMERCE_PRICING_VERSION,
          },
        ],
      },
      offerIdentifier: input.offerIdentifier,
    
    };
    if (usePaymentIntent && input.paymentIntentNonce) {
      const paymentIntentCheckout = application.get<CommercePaymentIntentCheckoutCapability>(COMMERCE_PAYMENT_INTENT_CHECKOUT_CAPABILITY_ID);
      const intentResult = await paymentIntentCheckout.start({ ...checkoutInput, paymentSourceReference: sourceReference });
      if (intentResult.status === "REJECTED" || intentResult.status === "FAILED") {
        if (intentResult.code !== "ORDER_CONFLICT" && intentResult.code !== "PAYMENT_SOURCE_CONFLICT") commerceFailure(intentResult.code);
        const sourceLookup = application.get<CommerceOrderSourceLookupCapability>(COMMERCE_ORDER_SOURCE_LOOKUP_CAPABILITY_ID);
        const found = await sourceLookup.find({ sourceReference });
        if (found.status !== "FOUND") fail("PAYMENT_REQUEST_IN_PROGRESS", 409);
        const prior = await findBoundPaymentIntentOrderById(found.value.orderId);
        const fingerprint = paymentIntentRequestFingerprint({ principalId: principal.id, accountId: access.account.id, purchasePlanId: plan.id, offerIdentifier: input.offerIdentifier ?? null, purchaseFor: input.purchaseFor });
        if (!prior || prior.accountId !== found.value.accountId || prior.totalMinor !== found.value.totalMinor || prior.currency !== found.value.currency ||
          !paymentIntentOrderMatches(prior, { principalId: principal.id, accountId: access.account.id, sourceReference, requestFingerprint: fingerprint, purchasePlanId: input.purchasePlanId, offerIdentifier: input.offerIdentifier ?? null, purchaseFor: input.purchaseFor })) fail("CHECKOUT_REQUEST_MISMATCH", 409);
        recoverableOrderId = prior.id;
        const saved = checkoutBinding(prior);
        if (saved?.planType !== plan.type || saved.renewalSubscriptionId !== renewalSubscriptionId) fail("CHECKOUT_REQUEST_MISMATCH", 409);
        if (prior.status === "PAID") return NextResponse.json({ orderId: prior.id, checkoutUrl: `/checkout/success?orderId=${encodeURIComponent(prior.id)}`, paymentConfirmed: true }, { headers: { "Cache-Control": "private, no-store" } });
        if (!mayResumePaymentIntentOrder(prior.status)) fail("PAYMENT_RECOVERY_REQUIRED", 409);
        if (prior.totalMinor <= 0) fail("PAYMENT_RECOVERY_REQUIRED", 409);
        const durableAttempt = await findPaymentIntentAttempt(sourceReference);
        if (!durableAttempt) fail("PAYMENT_RECOVERY_REQUIRED", 409);
        if (!paymentIntentAttemptMatches(durableAttempt, {
          sourceReference, commercialReference: prior.id, provider: "paymongo",
          livemode: runtimeEnvironment.PAYMONGO_LIVEMODE, amountMinor: prior.totalMinor, currency: prior.currency,
        })) {
          fail("CHECKOUT_REQUEST_MISMATCH", 409);
        }
        const payments = application.get<PaymentsPaymentIntentCapability>(PAYMENTS_PAYMENT_INTENT_CAPABILITY_ID);
        const resumed = await payments.create({ sourceReference, commercialReference: prior.id, amountMinor: prior.totalMinor, currency: prior.currency, livemode: runtimeEnvironment.PAYMONGO_LIVEMODE, paymentMethodAllowed: ["qrph"] });
        if (resumed.status !== "READY") fail("PAYMENT_RECOVERY_REQUIRED", 409);
        const intent = resumed.value;
        if (intent.status === "awaiting_payment_method") {
          const method = await payments.createPaymentMethod({ attemptId: intent.attemptId, type: "qrph" });
          if (method.status !== "CREATED") fail("PAYMENT_RECOVERY_REQUIRED", 409);
          const attached = await payments.attachPaymentMethod({ attemptId: intent.attemptId, paymentMethodId: method.value.paymentMethodId, clientKey: intent.clientKey });
          if (attached.status !== "ATTACHED") fail("PAYMENT_RECOVERY_REQUIRED", 409);
          return NextResponse.json({ orderId: prior.id, paymentIntent: { status: attached.value.status === "succeeded" ? "confirming" : attached.value.status, amountMinor: prior.totalMinor, currency: prior.currency, ...(attached.value.qrImageUrl ? { qrImageUrl: attached.value.qrImageUrl } : {}), ...(attached.value.expiresAt ? { expiresAt: attached.value.expiresAt } : {}) } }, { headers: { "Cache-Control": "private, no-store" } });
        }
        return NextResponse.json({ orderId: prior.id, paymentIntent: { status: intent.status === "succeeded" ? "confirming" : intent.status, amountMinor: prior.totalMinor, currency: prior.currency, ...(intent.qrImageUrl ? { qrImageUrl: intent.qrImageUrl } : {}), ...(intent.expiresAt ? { expiresAt: intent.expiresAt } : {}) } }, { headers: { "Cache-Control": "private, no-store" } });
      }
      if (intentResult.status === "PAYMENT_NOT_REQUIRED") return NextResponse.json({ orderId: intentResult.order.orderId, checkoutUrl: `/checkout/success?orderId=${encodeURIComponent(intentResult.order.orderId)}`, complimentary: true }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
      recoverableOrderId = intentResult.order.orderId;
      const intent = intentResult.paymentIntent;
      if (intent.status === "awaiting_payment_method") {
        const payments = application.get<PaymentsPaymentIntentCapability>(PAYMENTS_PAYMENT_INTENT_CAPABILITY_ID);
        const method = await payments.createPaymentMethod({ attemptId: intent.attemptId, type: "qrph" });
        if (method.status !== "CREATED") fail("PAYMENT_PROVIDER_UNAVAILABLE", 503);
        const attached = await payments.attachPaymentMethod({ attemptId: intent.attemptId, paymentMethodId: method.value.paymentMethodId, clientKey: intent.clientKey });
        if (attached.status !== "ATTACHED") fail("PAYMENT_PROVIDER_UNAVAILABLE", 503);
        const visibleStatus = attached.value.status === "succeeded" ? "confirming" : attached.value.status;
        return NextResponse.json({ orderId: intentResult.order.orderId, paymentIntent: { status: visibleStatus, amountMinor: intent.amountMinor, currency: intent.currency, ...(attached.value.qrImageUrl ? { qrImageUrl: attached.value.qrImageUrl } : {}), ...(attached.value.expiresAt ? { expiresAt: attached.value.expiresAt } : {}) } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
      }
      return NextResponse.json({ orderId: intentResult.order.orderId, paymentIntent: { status: intent.status === "succeeded" ? "confirming" : intent.status, amountMinor: intent.amountMinor, currency: intent.currency, ...(intent.qrImageUrl ? { qrImageUrl: intent.qrImageUrl } : {}), ...(intent.expiresAt ? { expiresAt: intent.expiresAt } : {}) } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }
        const checkout = application.get<CommerceCheckoutOrchestrationCapability>(COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID);
    const checkoutResult = await checkout.start({ ...checkoutInput, paymentSourceReference: sourceReference, payer: { name: access.account.displayName, email: access.account.billingEmail } });

    if (checkoutResult.status === "REJECTED" || checkoutResult.status === "FAILED") {
      commerceFailure(checkoutResult.code);
    }
    if (checkoutResult.status === "PAYMENT_NOT_REQUIRED") {
      return NextResponse.json(
        {
          orderId: checkoutResult.order.orderId,
          checkoutUrl: `/checkout/success?orderId=${encodeURIComponent(checkoutResult.order.orderId)}`,
          complimentary: true,
        },
        { status: 201 },
      );
    }

    return NextResponse.json(
      {
        orderId: checkoutResult.order.orderId,
        checkoutUrl: checkoutResult.payment.checkoutUrl,
      },
      { status: 201 },
    );
  } catch (error) {
    const protocol = error !== null && typeof error === "object"
      ? error as { code?: unknown; status?: unknown }
      : null;
    const safeProtocol = protocol && typeof protocol.code === "string" &&
      typeof protocol.status === "number" &&
      ((protocol.status === 401 && protocol.code === "UNAUTHENTICATED") ||
        (protocol.status === 403 && ["INVALID_ORIGIN", "RECENT_AUTH_REQUIRED"].includes(protocol.code)));
    const safeError = error instanceof CheckoutHttpError
      ? error
      : error instanceof Error && ["UNAUTHENTICATED", "INVALID_ORIGIN", "RECENT_AUTH_REQUIRED"].includes(error.message)
        ? error
        : error instanceof ZodError
        ? new CheckoutHttpError("INVALID_CHECKOUT", 422)
        : error instanceof SyntaxError
          ? new CheckoutHttpError("INVALID_CHECKOUT", 400)
          : safeProtocol
            ? error
            : new CheckoutHttpError("CHECKOUT_UNAVAILABLE", 503);
    const response = apiError(safeError);
    if (privateResponse) {
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("Vary", "Cookie");
    }
    if (privateResponse && recoverableOrderId && safeError instanceof CheckoutHttpError) {
      return NextResponse.json({ error: safeError.code, orderId: recoverableOrderId }, {
        status: safeError.status,
        headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
      });
    }
    return response;
  }
}

import { randomUUID } from "node:crypto";
import {
  ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
  type AccountsPurchaseAccessCapability,
} from "@bke/accounts/contracts/purchase-access.contract";
import {
  CATALOG_LOOKUP_CAPABILITY_ID,
  type CatalogLookupCapability,
} from "@bke/catalog/contracts/catalog.contract";
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
import { requireIdentityUser } from "@/v2/apps/web/auth/session";
import { apiError } from "@/v2/apps/web/http/api-error";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { checkoutSchema } from "@/v2/apps/web/http/validation";
import { getV2WebApplication } from "@/v2/apps/web/runtime";

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
    case "ORDER_CONFLICT":
    case "PAYMENT_SOURCE_CONFLICT":
      return fail("CHECKOUT_CREATION_IN_PROGRESS", 409);
    case "OFFER_NOT_AVAILABLE":
      return fail("OFFER_NOT_AVAILABLE", 422);
    case "ENTITLEMENT_CONFLICT":
      return fail("ENTITLEMENT_CONFLICT", 409);
    case "PAYMENT_PROVIDER_REJECTED":
      return fail("PAYMENT_PROVIDER_REJECTED", 502);
    case "INVALID_INPUT":
      return fail("INVALID_CHECKOUT", 422);
    case "ACCOUNT_UNAVAILABLE":
    case "LEGAL_UNAVAILABLE":
    case "COMMERCE_PERSISTENCE_UNAVAILABLE":
    case "ENTITLEMENTS_UNAVAILABLE":
    case "PAYMENTS_UNAVAILABLE":
    case "PAYMENT_PROVIDER_UNAVAILABLE":
      return fail(code, 503);
    default:
      return fail("CHECKOUT_FAILED", 503);
  }
}

export async function POST(request: Request) {
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
        acceptanceContext: "CHECKOUT",
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

    const checkout = application.get<CommerceCheckoutOrchestrationCapability>(
      COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID,
    );
    const checkoutResult = await checkout.start({
      principalId: principal.id,
      accountId: access.account.id,
      legal: requirements.map((requirement) => ({
        documentId: requirement.documentId,
        documentVersionId: requirement.documentVersionId,
        acceptanceContext: "CHECKOUT",
        slaVersion: requirement.slaVersion,
        renderedContentSha256: requirement.renderedContentSha256,
      })),
      order: {
        accountId: access.account.id,
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
      paymentSourceReference: `checkout:${principal.id}:${randomUUID()}`,
      payer: {
        name: access.account.displayName,
        email: access.account.billingEmail,
      },
    });

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
    return apiError(error);
  }
}

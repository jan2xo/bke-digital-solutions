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
  IDENTITY_LOOKUP_CAPABILITY_ID,
  type IdentityLookupCapability,
} from "@bke/identity/contracts/identity.contract";
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
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateAgentAccessToken } from "@/apps/web/agent-sessions/device-authorization";
import { durableAgentCheckoutSourceReference } from "@/apps/web/agent-sessions/store-checkout-recovery";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getV2WebApplication } from "@/apps/web/runtime";
import { resolveSelfPurchaseContinuation } from "@/apps/web/licensing/self-purchase-continuation";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const checkoutStartSchema = z.object({
  correlation_id: z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  purchase_plan_id: z.string().cuid(),
  purchase_mode: z.enum(["SELF", "GIFT"]),
  legal_version_ids: z.array(z.string().cuid()).min(2).max(3),
}).strict();

class CheckoutStartHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

function fail(code: string, status: number): never {
  throw new CheckoutStartHttpError(code, status);
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
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

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
    },
  });
}

export async function POST(request: Request) {
  try {
    const runtime = getRuntimeEnvironment();
    if (!runtime.AGENT_ACCOUNT_SESSION_ENABLED) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);

    const accessToken = bearerToken(request);
    if (!accessToken) {
      return json({ error: "INVALID_TOKEN" }, 401);
    }

    const input = checkoutStartSchema.parse(await request.json());

    const session = await db.$transaction(
      (tx) => authenticateAgentAccessToken(tx, {
        accessToken,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      }),
      { isolationLevel: "Serializable" },
    );
    if (session.status !== "authenticated") {
      return json({ error: "INVALID_TOKEN" }, 401);
    }

    if (!(await rateLimit(
      `agent-session:checkout-start:${session.userId}:${clientIp(request)}`,
      10,
      3600,
    )).allowed) {
      return json({ error: "RATE_LIMITED" }, 429);
    }

    const application = await getV2WebApplication();

    const identity = application.get<IdentityLookupCapability>(
      IDENTITY_LOOKUP_CAPABILITY_ID,
    );
    const identityResult = await identity.findById(session.userId);
    if (identityResult.status === "FAILED") {
      return json({ error: "IDENTITY_UNAVAILABLE" }, 503);
    }
    if (
      identityResult.status !== "FOUND" ||
      !identityResult.principal.emailVerified ||
      identityResult.principal.lifecycleState !== "ACTIVE"
    ) {
      return json({ error: "INVALID_TOKEN" }, 401);
    }
    const principal = identityResult.principal;

    const reacceptance = application.get<LegalReacceptanceStatusCapability>(
      LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID,
    );
    const reacceptanceStatus = await reacceptance.check({
      principalId: principal.id,
      principalEstablishedAt: principal.establishedAt,
    });
    if (reacceptanceStatus.status === "REACCEPTANCE_REQUIRED") {
      return json({ error: "LEGAL_REACCEPTANCE_REQUIRED" }, 409);
    }
    if (reacceptanceStatus.status === "FAILED") {
      return json({ error: "LEGAL_DOCUMENTS_UNAVAILABLE" }, 503);
    }

    const giftPurchase = input.purchase_mode === "GIFT";
    if (giftPurchase && !runtime.CLAIM_CODE_CHECKOUT_ENABLED) {
      return json({ error: "GIFT_CHECKOUT_DISABLED" }, 409);
    }

    const purchaseAccess = application.get<AccountsPurchaseAccessCapability>(
      ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
    );
    const access = await purchaseAccess.authorize({
      principalId: principal.id,
      accountId: session.accountId,
    });
    if (access.status === "REJECTED") {
      return json(
        { error: access.code === "ACCOUNT_ROLE_FORBIDDEN" ? "FORBIDDEN" : access.code },
        access.code === "ACCOUNT_ROLE_FORBIDDEN" ? 403 : 409,
      );
    }
    if (access.status === "FAILED") {
      return json({ error: "ACCOUNT_UNAVAILABLE" }, 503);
    }

    const planLookup = application.get<CommercePurchasePlanLookupCapability>(
      COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID,
    );
    const planResult = await planLookup.find({ planId: input.purchase_plan_id });
    if (
      planResult.status === "NOT_FOUND" ||
      (planResult.status === "FOUND" &&
        (!planResult.plan.active || !planResult.plan.editionId))
    ) {
      return json({ error: "INVALID_PURCHASE_PLAN" }, 422);
    }
    if (planResult.status === "FAILED") {
      return json({ error: "COMMERCE_UNAVAILABLE" }, 503);
    }
    const plan = planResult.plan;

    const pricingCapability = application.get<CommercePurchasePlanPricingCapability>(
      COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
    );
    const pricingResult = pricingCapability.resolve(plan);
    if (pricingResult.status === "FAILED") {
      return json({ error: "INVALID_PURCHASE_PLAN" }, 422);
    }
    const pricing = pricingResult.pricing;

    const catalog = application.get<CatalogLookupCapability>(
      CATALOG_LOOKUP_CAPABILITY_ID,
    );
    const editionResult = await catalog.findEditionById(plan.editionId!);
    if (
      editionResult.status === "NOT_FOUND" ||
      (editionResult.status === "FOUND" && !editionResult.value.active)
    ) {
      return json({ error: "INVALID_CATALOG_EDITION" }, 422);
    }
    if (editionResult.status === "FAILED") {
      return json({ error: "CATALOG_UNAVAILABLE" }, 503);
    }
    const edition = editionResult.value;

    const productResult = await catalog.findProductById(edition.productId);
    if (
      productResult.status === "NOT_FOUND" ||
      (productResult.status === "FOUND" &&
        (!productResult.value.active ||
          !productResult.value.available ||
          productResult.value.archivedAt !== null))
    ) {
      return json({ error: "INVALID_CATALOG_PRODUCT" }, 422);
    }
    if (productResult.status === "FAILED") {
      return json({ error: "CATALOG_UNAVAILABLE" }, 503);
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
      return json({ error: "ENTITLEMENT_CONFLICT" }, 409);
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
      selectedVersionIds: input.legal_version_ids,
      variables: {
        company_name: "BKE Digital Solutions",
        support_email: requiredHostFact("SUPPORT_EMAIL"),
        website: requiredHostFact("APP_URL"),
        business_address: requiredHostFact("BUSINESS_ADDRESS"),
      },
    });
    if (requirementsResult.status === "REJECTED") {
      return json({ error: "LEGAL_ACCEPTANCE_REQUIRED" }, 409);
    }
    if (requirementsResult.status === "FAILED") {
      return json({ error: "LEGAL_DOCUMENTS_UNAVAILABLE" }, 503);
    }
    const requirements = requirementsResult.requirements;

    const acceptance = application.get<LegalAcceptanceCapability>(
      LEGAL_ACCEPTANCE_CAPABILITY_ID,
    );
    const ipAddress = clientIp(request).slice(0, 128);
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
        ipAddress,
        userAgent,
      });
      if (recorded.status === "REJECTED") {
        return json({ error: "LEGAL_ACCEPTANCE_REQUIRED" }, 409);
      }
      if (recorded.status === "FAILED") {
        return json({ error: "LEGAL_DOCUMENTS_UNAVAILABLE" }, 503);
      }
    }

    const name = planLabel(plan.type);
    const suffix =
      `${Date.now().toString(36).toUpperCase()}${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
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

    const sourceReference = durableAgentCheckoutSourceReference(
      session,
      input.correlation_id,
    );
    const checkout = application.get<CommerceCheckoutOrchestrationCapability>(
      COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID,
    );
    const checkoutResult = await checkout.start({
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
        fulfillmentMode: giftPurchase ? "CLAIM_CODE" : "ACCOUNT_ENTITLEMENT",
        fulfillmentSnapshot: {},
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
            description:
              `${name}; ${plan.renewalBehavior === "NONE" ? "no renewal" : "customer-authorized renewal"}`,
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
      paymentSourceReference: sourceReference,
      payer: {
        name: access.account.displayName,
        email: access.account.billingEmail,
      },
    });

    if (checkoutResult.status === "REJECTED" || checkoutResult.status === "FAILED") {
      commerceFailure(checkoutResult.code);
    }

    const appUrl = requiredHostFact("APP_URL");
    if (checkoutResult.status === "PAYMENT_NOT_REQUIRED") {
      const successUrl = new URL("/checkout/success", appUrl);
      successUrl.searchParams.set("orderId", checkoutResult.order.orderId);
      return json(
        {
          status: "ready",
          correlation_id: input.correlation_id,
          order_id: checkoutResult.order.orderId,
          checkout_url: successUrl.toString(),
          complimentary: true,
        },
        201,
      );
    }

    return json(
      {
        status: "ready",
        correlation_id: input.correlation_id,
        order_id: checkoutResult.order.orderId,
        checkout_url: new URL(checkoutResult.payment.checkoutUrl, appUrl).toString(),
        complimentary: false,
      },
      201,
    );
  } catch (error) {
    if (error instanceof CheckoutStartHttpError) {
      return json({ error: error.code }, error.status);
    }
    return apiError(error);
  }
}

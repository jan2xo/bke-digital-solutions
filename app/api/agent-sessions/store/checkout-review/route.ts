import {
  ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
  type AccountsPurchaseAccessCapability,
} from "@bke/accounts/contracts/purchase-access.contract";
import {
  CATALOG_LOOKUP_CAPABILITY_ID,
  type CatalogLookupCapability,
} from "@bke/catalog/contracts/catalog.contract";
import {
  COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID,
  type CommercePurchasePlanLookupCapability,
} from "@bke/commerce/contracts/purchase-plan-lookup.contract";
import {
  COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  type CommercePurchasePlanPricingCapability,
} from "@bke/commerce/contracts/purchase-plan-pricing.contract";
import {
  IDENTITY_LOOKUP_CAPABILITY_ID,
  type IdentityLookupCapability,
} from "@bke/identity/contracts/identity.contract";
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
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getV2WebApplication } from "@/apps/web/runtime";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const querySchema = z.object({
  purchase_plan_id: z.string().trim().min(1).max(256),
}).strict();

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
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

export async function GET(request: Request) {
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

    if (!(await rateLimit(
      `agent-session:checkout-review:${clientIp(request)}`,
      180,
      3600,
    )).allowed) {
      return json({ error: "RATE_LIMITED" }, 429);
    }

    const url = new URL(request.url);
    const input = querySchema.parse({
      purchase_plan_id: url.searchParams.get("purchase_plan_id"),
    });

    const session = await db.$transaction(async (tx) =>
      authenticateAgentAccessToken(tx, {
        accessToken,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      }), { isolationLevel: "Serializable" });

    if (session.status !== "authenticated") {
      return json({ error: "INVALID_TOKEN" }, 401);
    }

    const application = await getV2WebApplication();

    const identity = application.get<IdentityLookupCapability>(
      IDENTITY_LOOKUP_CAPABILITY_ID,
    );
    const identityResult = await identity.findById(session.userId);
    if (identityResult.status === "FAILED") {
      return json({ status: "identity_unavailable" }, 503);
    }
    if (
      identityResult.status !== "FOUND" ||
      !identityResult.principal.emailVerified ||
      identityResult.principal.lifecycleState !== "ACTIVE"
    ) {
      return json({ error: "INVALID_TOKEN" }, 401);
    }
    const principal = identityResult.principal;

    const purchaseAccess = application.get<AccountsPurchaseAccessCapability>(
      ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
    );
    const access = await purchaseAccess.authorize({
      principalId: principal.id,
      accountId: session.accountId,
    });
    if (access.status === "FAILED") {
      return json({ status: "account_unavailable" }, 503);
    }
    if (access.status === "REJECTED") {
      return json({
        status: access.code === "ACCOUNT_ROLE_FORBIDDEN"
          ? "account_forbidden"
          : access.code === "ACCOUNT_NOT_ACTIVE"
            ? "account_not_active"
            : "account_not_found",
      }, access.code === "ACCOUNT_ROLE_FORBIDDEN" ? 403 : 409);
    }

    const reacceptance = application.get<LegalReacceptanceStatusCapability>(
      LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID,
    );
    const reacceptanceStatus = await reacceptance.check({
      principalId: principal.id,
      principalEstablishedAt: principal.establishedAt,
    });
    if (reacceptanceStatus.status === "FAILED") {
      return json({ status: "legal_unavailable" }, 503);
    }
    if (reacceptanceStatus.status === "REACCEPTANCE_REQUIRED") {
      return json({
        status: "legal_reacceptance_required",
        pending_legal: reacceptanceStatus.pending.map((item) => ({
          document_type: item.documentType,
          title: item.title,
          slug: item.slug,
          document_version_id: item.documentVersionId,
          version: item.version,
        })),
      }, 409);
    }

    const planLookup = application.get<CommercePurchasePlanLookupCapability>(
      COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID,
    );
    const planResult = await planLookup.find({
      planId: input.purchase_plan_id,
    });
    if (
      planResult.status === "NOT_FOUND" ||
      (planResult.status === "FOUND" &&
        (!planResult.plan.active || !planResult.plan.editionId))
    ) {
      return json({ status: "plan_not_available" }, 404);
    }
    if (planResult.status === "FAILED") {
      return json({ status: "commerce_unavailable" }, 503);
    }
    const plan = planResult.plan;

    const pricing = application.get<CommercePurchasePlanPricingCapability>(
      COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
    );
    const pricingResult = pricing.resolve(plan);
    if (pricingResult.status === "FAILED") {
      return json({ status: "plan_not_available" }, 422);
    }
    const terms = pricingResult.pricing;

    const catalog = application.get<CatalogLookupCapability>(
      CATALOG_LOOKUP_CAPABILITY_ID,
    );
    const editionResult = await catalog.findEditionById(plan.editionId!);
    if (
      editionResult.status === "NOT_FOUND" ||
      (editionResult.status === "FOUND" && !editionResult.value.active)
    ) {
      return json({ status: "plan_not_available" }, 404);
    }
    if (editionResult.status === "FAILED") {
      return json({ status: "catalog_unavailable" }, 503);
    }
    const edition = editionResult.value;

    const productResult = await catalog.findProductById(edition.productId);
    if (
      productResult.status === "NOT_FOUND" ||
      (productResult.status === "FOUND" &&
        (!productResult.value.active ||
          !productResult.value.available ||
          !productResult.value.publishedAt ||
          productResult.value.archivedAt !== null ||
          !productResult.value.productId))
    ) {
      return json({ status: "plan_not_available" }, 404);
    }
    if (productResult.status === "FAILED") {
      return json({ status: "catalog_unavailable" }, 503);
    }
    const product = productResult.value;

    const legal = application.get<LegalCheckoutRequirementsCapability>(
      LEGAL_CHECKOUT_REQUIREMENTS_CAPABILITY_ID,
    );
    const legalResult = await legal.resolve({
      planType: plan.type,
    });
    if (legalResult.status === "FAILED") {
      return json({ status: "legal_unavailable" }, 503);
    }
    if (legalResult.status === "REJECTED") {
      return json({ status: "legal_acceptance_required" }, 409);
    }

    return json({
      status: "ready",
      purchase_modes: runtime.CLAIM_CODE_CHECKOUT_ENABLED
        ? ["SELF", "GIFT"]
        : ["SELF"],
      product: {
        product_id: product.productId,
        slug: product.slug,
        display_name: product.name,
        summary: product.summary,
      },
      edition: {
        edition_id: edition.id,
        slug: edition.slug,
        name: edition.name,
        max_users: edition.maxUsers,
        max_devices_per_user: edition.maxDevicesPerUser,
        update_policy: edition.updatePolicy,
      },
      plan: {
        purchase_plan_id: plan.id,
        type: plan.type,
        currency: plan.currency,
        amount_minor: terms.amountMinor,
        billing_type: terms.billingType,
        interval_unit: terms.intervalUnit,
        interval_count: terms.intervalCount,
        renewal_behavior: plan.renewalBehavior,
        savings_minor: terms.savingsMinor,
        effective_monthly_minor: terms.effectiveMonthlyMinor,
      },
      legal_documents: legalResult.requirements.map((requirement) => ({
        document_type: requirement.documentType,
        title: requirement.title,
        slug: requirement.slug,
        document_version_id: requirement.documentVersionId,
        version: requirement.version,
        sla_version: requirement.slaVersion,
        requires_reacceptance: requirement.requiresReacceptance,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

import { NextResponse } from "next/server";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateAgentAccessToken } from "@/apps/web/agent-sessions/device-authorization";
import {
  COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  readAgentStoreCatalog,
} from "@/apps/web/catalog/agent-store-catalog";
import type { CommercePurchasePlanPricingCapability } from "@bke/commerce/contracts/purchase-plan-pricing.contract";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getV2WebApplication } from "@/apps/web/runtime";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
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
      return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 401 });
    }

    if (!(await rateLimit(
      `agent-session:store:${clientIp(request)}`,
      300,
      3600,
    )).allowed) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const application = await getV2WebApplication();
    const pricing = application.get<CommercePurchasePlanPricingCapability>(
      COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
    );

    const result = await db.$transaction(async (tx) => {
      const session = await authenticateAgentAccessToken(tx, {
        accessToken,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      });
      if (session.status !== "authenticated") {
        return { status: "invalid_token" as const };
      }

      const products = await readAgentStoreCatalog(tx, pricing);
      return {
        status: "ok" as const,
        accountId: session.accountId,
        products,
      };
    }, { isolationLevel: "Serializable" });

    if (result.status !== "ok") {
      return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 401 });
    }

    return NextResponse.json({
      status: "ok",
      account_id: result.accountId,
      gift_checkout_enabled: runtime.CLAIM_CODE_CHECKOUT_ENABLED,
      products: result.products.map((product) => ({
        product_id: product.productId,
        slug: product.slug,
        display_name: product.displayName,
        summary: product.summary,
        description: product.description,
        product_type: product.productType,
        execution_type: product.executionType,
        editions: product.editions.map((edition) => ({
          edition_id: edition.editionId,
          slug: edition.slug,
          name: edition.name,
          description: edition.description,
          features: edition.features,
          max_users: edition.maxUsers,
          max_devices_per_user: edition.maxDevicesPerUser,
          update_policy: edition.updatePolicy,
          plans: edition.plans.map((plan) => ({
            purchase_plan_id: plan.purchasePlanId,
            type: plan.type,
            currency: plan.currency,
            amount_minor: plan.amountMinor,
            billing_type: plan.billingType,
            interval_unit: plan.intervalUnit,
            interval_count: plan.intervalCount,
            renewal_behavior: plan.renewalBehavior,
            savings_minor: plan.savingsMinor,
            effective_monthly_minor: plan.effectiveMonthlyMinor,
          })),
        })),
      })),
    }, {
      headers: {
        "cache-control": "no-store",
        "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

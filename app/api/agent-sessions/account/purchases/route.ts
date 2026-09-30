import { NextResponse } from "next/server";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateNativeAgentRequest } from "@/apps/web/agent-sessions/native-mfa";
import { getAgentAccountPurchasesOverview } from "@/apps/web/accounts/agent-account-purchases-overview";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-bke-account-session-version":
        AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
    },
  });
}

function errorResponse(error: unknown) {
  const result = apiError(error);
  result.headers.set("cache-control", "no-store");
  result.headers.set(
    "x-bke-account-session-version",
    AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  );
  return result;
}

export async function GET(request: Request) {
  try {
    const runtime = getRuntimeEnvironment();
    if (!runtime.AGENT_ACCOUNT_SESSION_ENABLED) {
      return NextResponse.json(
        { error: "NOT_FOUND" },
        { status: 404 },
      );
    }

    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);

    const authenticated =
      await authenticateNativeAgentRequest(request);
    if (authenticated.status !== "authenticated") {
      return response({ error: "INVALID_TOKEN" }, 401);
    }

    if (!(await rateLimit(
      `agent-session:account-purchases:${authenticated.userId}:${clientIp(request)}`,
      300,
      3600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const overview = await getAgentAccountPurchasesOverview({
      principalId: authenticated.userId,
      accountId: authenticated.accountId,
    });

    if (overview.status === "forbidden") {
      return response({ error: "ACCOUNT_FORBIDDEN" }, 403);
    }
    if (overview.status !== "ready") {
      return response(
        { error: "ACCOUNT_PURCHASES_UNAVAILABLE" },
        503,
      );
    }

    return response({
      status: "ready",
      account: {
        type: overview.account.type,
        display_name: overview.account.displayName,
        lifecycle_state: overview.account.lifecycleState,
        role: overview.account.role,
      },
      permissions: {
        view_orders: overview.permissions.viewOrders,
        view_subscriptions:
          overview.permissions.viewSubscriptions,
        view_all_licenses:
          overview.permissions.viewAllLicenses,
        manage_license_seats:
          overview.permissions.manageLicenseSeats,
      },
      licenses: overview.licenses.map((license) => ({
        product_name: license.productName,
        edition_name: license.editionName,
        plan_type: license.planType,
        status: license.status,
        key_last_four: license.keyLastFour,
        expires_at: license.expiresAt?.toISOString() ?? null,
        max_devices: license.maxDevices,
        active_devices: license.activeDevices,
        max_seats: license.maxSeats,
        assigned_seats: license.assignedSeats,
        seat_management_handle:
          license.seatManagementHandle,
      })),
      subscriptions: overview.subscriptions.map(
        (subscription) => ({
          product_name: subscription.productName,
          edition_name: subscription.editionName,
          plan_type: subscription.planType,
          status: subscription.status,
          seats: subscription.seats,
          current_period_end:
            subscription.currentPeriodEnd.toISOString(),
        }),
      ),
      orders: overview.orders.map((order) => ({
        number: order.number,
        status: order.status,
        total_minor: order.totalMinor,
        currency: order.currency,
        created_at: order.createdAt.toISOString(),
        invoice_available: order.invoiceAvailable,
        items: order.items.map((item) => ({
          product_name: item.productName,
          edition_name: item.editionName,
          plan_name: item.planName,
        })),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

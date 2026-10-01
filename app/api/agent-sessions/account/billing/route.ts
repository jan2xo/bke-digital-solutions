import { NextResponse } from "next/server";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateNativeAgentRequest } from "@/apps/web/agent-sessions/native-mfa";
import { getAgentAccountBillingHistory } from "@/apps/web/accounts/agent-account-billing-history";
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
      `agent-session:account-billing:${authenticated.userId}:${authenticated.accountId}:${clientIp(request)}`,
      300,
      3600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const history = await getAgentAccountBillingHistory({
      principalId: authenticated.userId,
      accountId: authenticated.accountId,
    });

    if (history.status === "forbidden") {
      return response({ error: "ACCOUNT_FORBIDDEN" }, 403);
    }
    if (history.status !== "ready") {
      return response(
        { error: "ACCOUNT_BILLING_UNAVAILABLE" },
        503,
      );
    }

    return response({
      status: "ready",
      account: {
        type: history.account.type,
        display_name: history.account.displayName,
        lifecycle_state: history.account.lifecycleState,
        role: history.account.role,
      },
      permissions: {
        view_invoices: history.permissions.viewInvoices,
        view_payments: history.permissions.viewPayments,
      },
      invoices: history.invoices.map((invoice) => ({
        number: invoice.number,
        status: invoice.status,
        order_number: invoice.orderNumber,
        currency: invoice.currency,
        subtotal_minor: invoice.subtotalMinor,
        tax_minor: invoice.taxMinor,
        total_minor: invoice.totalMinor,
        issued_at: invoice.issuedAt?.toISOString() ?? null,
        created_at: invoice.createdAt.toISOString(),
        lines: invoice.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unit_amount_minor: line.unitAmountMinor,
          total_minor: line.totalMinor,
        })),
      })),
      payments: history.payments.map((payment) => ({
        order_number: payment.orderNumber,
        status: payment.status,
        amount_minor: payment.amountMinor,
        currency: payment.currency,
        paid_at: payment.paidAt?.toISOString() ?? null,
        created_at: payment.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

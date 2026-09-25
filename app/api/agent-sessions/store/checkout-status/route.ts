import {
  COMMERCE_ORDER_SOURCE_LOOKUP_CAPABILITY_ID,
  type CommerceOrderSourceLookupCapability,
} from "@bke/commerce/contracts/order-source-lookup.contract";
import {
  IDENTITY_LOOKUP_CAPABILITY_ID,
  type IdentityLookupCapability,
} from "@bke/identity/contracts/identity.contract";
import {
  PAYMENTS_CHECKOUT_ATTEMPT_LOOKUP_CAPABILITY_ID,
  type PaymentsCheckoutAttemptLookupCapability,
} from "@bke/payments/contracts/checkout-attempt-lookup.contract";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateAgentAccessToken } from "@/apps/web/agent-sessions/device-authorization";
import { agentCheckoutSourceReferenceCandidates } from "@/apps/web/agent-sessions/store-checkout-recovery";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getV2WebApplication } from "@/apps/web/runtime";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const checkoutStatusSchema = z.object({
  correlation_id: z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

class CheckoutStatusHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

function fail(code: string, status: number): never {
  throw new CheckoutStatusHttpError(code, status);
}

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

function checkoutStatusInput(request: Request) {
  const url = new URL(request.url);
  if (
    url.searchParams.getAll("correlation_id").length !== 1 ||
    [...url.searchParams.keys()].some((key) => key !== "correlation_id")
  ) {
    fail("INVALID_REQUEST", 400);
  }
  return checkoutStatusSchema.parse({
    correlation_id: url.searchParams.get("correlation_id"),
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

    const input = checkoutStatusInput(request);
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
      `agent-session:checkout-status:${session.userId}:${clientIp(request)}`,
      120,
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

    const sourceReferences = await db.$transaction(
      (tx) =>
        agentCheckoutSourceReferenceCandidates(
          tx,
          session,
          input.correlation_id,
        ),
      { isolationLevel: "Serializable" },
    );
    const orderLookup = application.get<CommerceOrderSourceLookupCapability>(
      COMMERCE_ORDER_SOURCE_LOOKUP_CAPABILITY_ID,
    );

    let sourceReference: string | null = null;
    let order:
      | Awaited<ReturnType<CommerceOrderSourceLookupCapability["find"]>> extends
          { status: "FOUND"; value: infer TValue }
        ? TValue
        : never
      | null = null;

    for (const candidate of sourceReferences) {
      const orderResult = await orderLookup.find({ sourceReference: candidate });
      if (orderResult.status === "FAILED") {
        return json({ error: "COMMERCE_UNAVAILABLE" }, 503);
      }
      if (orderResult.status === "FOUND") {
        sourceReference = candidate;
        order = orderResult.value;
        break;
      }
    }

    if (!sourceReference || !order) {
      return json({
        status: "not_found",
        correlation_id: input.correlation_id,
      });
    }

    if (
      order.sourceReference !== sourceReference ||
      order.accountId !== session.accountId
    ) {
      return json({ error: "FORBIDDEN" }, 403);
    }

    const paymentLookup = application.get<PaymentsCheckoutAttemptLookupCapability>(
      PAYMENTS_CHECKOUT_ATTEMPT_LOOKUP_CAPABILITY_ID,
    );
    const paymentResult = await paymentLookup.find({ sourceReference });
    if (paymentResult.status === "FAILED") {
      return json({ error: "PAYMENTS_UNAVAILABLE" }, 503);
    }

    let paymentStatus:
      | "NOT_REQUIRED"
      | "NOT_STARTED"
      | "CREATING"
      | "PENDING"
      | "SETTLED"
      | "FAILED"
      | "CANCELLED";
    let checkoutUrl: string | null = null;

    if (order.status === "CANCELLED") {
      paymentStatus = "CANCELLED";
    } else if (order.paidAt !== null) {
      paymentStatus = order.totalMinor === 0 ? "NOT_REQUIRED" : "SETTLED";
    } else if (order.totalMinor === 0) {
      paymentStatus = "NOT_REQUIRED";
    } else if (paymentResult.status === "NOT_FOUND") {
      paymentStatus = "NOT_STARTED";
    } else {
      if (paymentResult.value.commercialReference !== order.orderId) {
        return json({ error: "CHECKOUT_STATE_CONFLICT" }, 409);
      }
      paymentStatus = paymentResult.value.status;
      if (
        order.status === "PENDING" &&
        paymentResult.value.status === "PENDING" &&
        paymentResult.value.checkoutUrl
      ) {
        checkoutUrl = paymentResult.value.checkoutUrl;
      }
    }

    return json({
      status: "found",
      correlation_id: input.correlation_id,
      order_id: order.orderId,
      order_number: order.orderNumber,
      order_status: order.status,
      fulfillment_mode: order.fulfillmentMode,
      payment_status: paymentStatus,
      checkout_url: checkoutUrl,
      paid_at: order.paidAt?.toISOString() ?? null,
    });
  } catch (error) {
    if (error instanceof CheckoutStatusHttpError) {
      return json({ error: error.code }, error.status);
    }
    if (error instanceof z.ZodError) {
      return json({ error: "INVALID_REQUEST" }, 400);
    }
    const response = apiError(error);
    response.headers.set(
      "x-bke-account-session-version",
      AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
    );
    response.headers.set("cache-control", "no-store");
    return response;
  }
}

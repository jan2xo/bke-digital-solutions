import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateNativeAgentRequest } from "@/apps/web/agent-sessions/native-mfa";
import {
  resolveAgentOrderContinueHandle,
  validAgentOrderContinueHandle,
} from "@/apps/web/accounts/agent-order-management";
import { continueAgentPendingOrder } from "@/apps/web/accounts/agent-order-authority";
import { assertLegalAcceptanceCurrent } from "@/apps/web/legal/service";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  order_continue_handle: z
    .string()
    .max(128)
    .refine(validAgentOrderContinueHandle, {
      message: "Invalid pending-order continuation handle.",
    }),
}).strict();

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

function protocolApiError(error: unknown) {
  const result = apiError(error);
  result.headers.set("cache-control", "no-store");
  result.headers.set(
    "x-bke-account-session-version",
    AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  );
  return result;
}

export async function POST(request: Request) {
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
      `agent-session:order-continue:${authenticated.userId}:${authenticated.accountId}:${clientIp(request)}`,
      60,
      3600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const input = schema.parse(await request.json());
    const orderId = await resolveAgentOrderContinueHandle({
      accountId: authenticated.accountId,
      handle: input.order_continue_handle,
    });
    if (!orderId) {
      return response({ error: "ORDER_NOT_FOUND" }, 404);
    }

    await assertLegalAcceptanceCurrent(
      authenticated.userId,
    );

    const result = await continueAgentPendingOrder({
      principalId: authenticated.userId,
      accountId: authenticated.accountId,
      orderId,
    });

    switch (result.status) {
      case "continued":
        return response({
          status: "continued",
          checkout_url: result.checkoutUrl,
        });
      case "order_not_found":
        return response({ error: "ORDER_NOT_FOUND" }, 404);
      case "account_not_active":
        return response({ error: "ACCOUNT_NOT_ACTIVE" }, 409);
      case "account_forbidden":
        return response({ error: "ACCOUNT_FORBIDDEN" }, 403);
      case "checkout_creation_in_progress":
        return response(
          { error: "CHECKOUT_CREATION_IN_PROGRESS" },
          409,
        );
      case "failed":
        return response(
          { error: "ORDER_CONTINUE_UNAVAILABLE" },
          503,
        );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return protocolApiError(error);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateNativeAgentRequest } from "@/apps/web/agent-sessions/native-mfa";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import {
  createPrivacyRequest,
  listPrivacyRequestsForAgentSession,
  normalizePrivacyRequestType,
  PRIVACY_REQUEST_TYPES,
} from "@/apps/web/privacy/requests";
import { getRuntimeEnvironment } from "@/platform/host/env";

const createSchema = z.object({
  request_type: z.enum(PRIVACY_REQUEST_TYPES),
  summary: z.string().trim().min(10).max(2_000),
}).strict();

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
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

async function authenticatedSession(request: Request) {
  const runtime = getRuntimeEnvironment();
  if (!runtime.AGENT_ACCOUNT_SESSION_ENABLED) {
    return { status: "disabled" as const };
  }

  rejectBrowserOriginForAgent(request);
  requireAgentAccountSessionProtocol(request);

  const authenticated = await authenticateNativeAgentRequest(request);
  if (authenticated.status !== "authenticated") {
    return { status: "invalid_token" as const };
  }

  return {
    status: "authenticated" as const,
    userId: authenticated.userId,
    accountId: authenticated.accountId,
  };
}

export async function GET(request: Request) {
  try {
    const session = await authenticatedSession(request);
    if (session.status === "disabled") {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    if (session.status !== "authenticated") {
      return response({ error: "INVALID_TOKEN" }, 401);
    }

    if (!(await rateLimit(
      `agent-session:privacy-list:${session.userId}:${clientIp(request)}`,
      300,
      3600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const url = new URL(request.url);
    const input = listSchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const requests = await listPrivacyRequestsForAgentSession({
      userId: session.userId,
      accountId: session.accountId,
      limit: input.limit,
    });

    return response({
      status: "ok",
      account_id: session.accountId,
      request_types: PRIVACY_REQUEST_TYPES,
      requests: requests.map((item) => ({
        id: item.id,
        scope: item.customerAccountId ? "ACCOUNT" : "USER",
        request_type: item.requestType,
        status: item.status,
        summary: item.summary,
        response_summary: item.responseSummary,
        reviewed_at: item.reviewedAt?.toISOString() ?? null,
        closed_at: item.closedAt?.toISOString() ?? null,
        created_at: item.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await authenticatedSession(request);
    if (session.status === "disabled") {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    if (session.status !== "authenticated") {
      return response({ error: "INVALID_TOKEN" }, 401);
    }

    if (!(await rateLimit(
      `agent-session:privacy-create:${session.userId}:${clientIp(request)}`,
      20,
      3600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const input = createSchema.parse(await request.json());
    const created = await createPrivacyRequest({
      userId: session.userId,
      accountId: session.accountId,
      requestType: normalizePrivacyRequestType(input.request_type),
      summary: input.summary,
      request,
    });

    return response({
      status: "created",
      account_id: session.accountId,
      request: {
        id: created.id,
        request_type: created.requestType,
        status: created.status,
      },
    }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return apiError(error);
  }
}

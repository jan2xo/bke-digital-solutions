import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateAgentAccessToken } from "@/apps/web/agent-sessions/device-authorization";
import { listNotificationsForAgentSession } from "@/apps/web/notifications/center";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
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
    if (!accessToken) return json({ error: "INVALID_TOKEN" }, 401);

    if (!(await rateLimit(
      `agent-session:notification-inbox:${clientIp(request)}`,
      300,
      3600,
    )).allowed) {
      return json({ error: "RATE_LIMITED" }, 429);
    }

    const url = new URL(request.url);
    const input = querySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const session = await db.$transaction(async (tx) => {
      const authenticated = await authenticateAgentAccessToken(tx, {
        accessToken,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      });
      if (authenticated.status !== "authenticated") {
        return { status: "invalid_token" as const };
      }

      const user = await tx.user.findUnique({
        where: { id: authenticated.userId },
        select: { role: true },
      });
      if (!user) {
        return { status: "invalid_token" as const };
      }

      return {
        status: "authenticated" as const,
        userId: authenticated.userId,
        accountId: authenticated.accountId,
        role: user.role,
      };
    }, { isolationLevel: "Serializable" });

    if (session.status !== "authenticated") {
      return json({ error: "INVALID_TOKEN" }, 401);
    }

    const notifications = await listNotificationsForAgentSession({
      userId: session.userId,
      role: session.role,
      accountId: session.accountId,
      limit: input.limit,
    });

    return json({
      status: "ok",
      account_id: session.accountId,
      notifications: notifications.map((notification) => ({
        id: notification.id,
        source: notification.source,
        event: notification.event,
        title: notification.title,
        body: notification.body,
        category: notification.category,
        priority: notification.priority,
        state: notification.state,
        audience_kind: notification.audienceKind,
        product_id: notification.productId,
        created_at: notification.createdAt,
        expires_at: notification.expiresAt,
        data: notification.data,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

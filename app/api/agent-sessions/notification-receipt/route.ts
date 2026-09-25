import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateAgentAccessToken } from "@/apps/web/agent-sessions/device-authorization";
import { mutateNotificationReceiptForAgentSession } from "@/apps/web/notifications/center";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const bodySchema = z.object({
  notification_id: z.string().trim().min(1).max(160),
  action: z.enum(["MARK_READ", "DISMISS"]),
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

export async function POST(request: Request) {
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
      `agent-session:notification-receipt:${clientIp(request)}`,
      300,
      3600,
    )).allowed) {
      return json({ error: "RATE_LIMITED" }, 429);
    }

    const input = bodySchema.parse(await request.json());

    const session = await db.$transaction(async (tx) => {
      const authenticated = await authenticateAgentAccessToken(tx, {
        accessToken,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      });
      if (authenticated.status !== "authenticated") {
        return { status: "invalid_token" as const };
      }

      return {
        status: "authenticated" as const,
        userId: authenticated.userId,
        accountId: authenticated.accountId,
      };
    }, { isolationLevel: "Serializable" });

    if (session.status !== "authenticated") {
      return json({ error: "INVALID_TOKEN" }, 401);
    }

    const result = await mutateNotificationReceiptForAgentSession({
      userId: session.userId,
      accountId: session.accountId,
      notificationId: input.notification_id,
      action: input.action,
    });

    return json({
      status: "ok",
      account_id: session.accountId,
      mutation_status: result.status,
      state: "state" in result ? result.state : null,
    });
  } catch (error) {
    return apiError(error);
  }
}

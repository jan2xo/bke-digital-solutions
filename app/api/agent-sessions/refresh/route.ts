import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { refreshAgentAccountSession } from "@/apps/web/agent-sessions/device-authorization";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";
import { db } from "@/platform/host/db";

const schema = z.object({
  refresh_token: z.string().min(32).max(8192),
}).strict();

export async function POST(request: Request) {
  try {
    const runtime = getRuntimeEnvironment();
    if (!runtime.V3_AGENT_ACCOUNT_SESSION_ENABLED) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);
    const input = schema.parse(await request.json());
    if (!(await rateLimit(`agent-session:refresh:${clientIp(request)}`, 300, 3600)).allowed) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const result = await db.$transaction(
      (tx) => refreshAgentAccountSession(tx, {
        refreshToken: input.refresh_token,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      }),
      { isolationLevel: "Serializable" },
    );

    if (result.status !== "refreshed") {
      return NextResponse.json(
        { error: result.status === "replay_detected" ? "REFRESH_TOKEN_REPLAY" : "INVALID_GRANT" },
        { status: 401 },
      );
    }

    return NextResponse.json({
      status: "refreshed",
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      expires_in: Math.max(
        1,
        Math.floor((new Date(result.accessExpiresAt).getTime() - Date.now()) / 1000),
      ),
      session_id: result.sessionId,
      user_id: result.userId,
      email: result.email,
      account_id: result.accountId,
      account_type: result.accountType,
      account_display_name: result.accountDisplayName,
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

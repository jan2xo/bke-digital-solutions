import { NextResponse } from "next/server";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { acknowledgeAgentSessionHandoff } from "@/apps/web/agent-sessions/device-authorization";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";
import { db } from "@/platform/host/db";

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
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
    if (!accessToken) {
      return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 401 });
    }

    if (!(await rateLimit(`agent-session:ack:${clientIp(request)}`, 300, 3600)).allowed) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const result = await db.$transaction(
      (tx) => acknowledgeAgentSessionHandoff(tx, {
        accessToken,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      }),
      { isolationLevel: "Serializable" },
    );

    if (result !== "acknowledged") {
      return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 401 });
    }

    return NextResponse.json(
      { status: "acknowledged" },
      {
        headers: {
          "cache-control": "no-store",
          "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
        },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}

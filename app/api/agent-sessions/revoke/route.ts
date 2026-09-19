import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { revokeAgentAccountSession } from "@/apps/web/agent-sessions/device-authorization";
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
    if (!(await rateLimit(`agent-session:revoke:${clientIp(request)}`, 120, 3600)).allowed) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    await db.$transaction(
      (tx) => revokeAgentAccountSession(tx, {
        refreshToken: input.refresh_token,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      }),
      { isolationLevel: "Serializable" },
    );

    return NextResponse.json(
      { status: "revoked" },
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

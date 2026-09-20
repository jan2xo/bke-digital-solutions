import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { pollAgentDeviceAuthorization } from "@/apps/web/agent-sessions/device-authorization";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";
import { db } from "@/platform/host/db";

const schema = z.object({
  device_code: z.string().min(32).max(256),
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

    if (!(await rateLimit(`agent-session:token:${clientIp(request)}`, 600, 3600)).allowed) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const result = await db.$transaction(
      (tx) => pollAgentDeviceAuthorization(tx, {
        deviceCode: input.device_code,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
        encryptionKey: runtime.AGENT_ACCOUNT_SESSION_ENCRYPTION_KEY!,
      }),
      { isolationLevel: "Serializable" },
    );

    if (result.status !== "approved") {
      return NextResponse.json(
        { status: result.status },
        {
          status: 200,
          headers: {
            "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
          },
        },
      );
    }

    return NextResponse.json({
      status: "approved",
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      expires_in: Math.max(
        1,
        Math.floor((new Date(result.accessExpiresAt).getTime() - Date.now()) / 1000),
      ),
      refresh_expires_in: Math.max(
        1,
        Math.floor((new Date(result.refreshExpiresAt).getTime() - Date.now()) / 1000),
      ),
      session_id: result.sessionId,
      user_id: result.userId,
      email: result.email,
      account_id: result.accountId,
      account_type: result.accountType,
      account_display_name: result.accountDisplayName,
    }, {
      status: 200,
      headers: {
        "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

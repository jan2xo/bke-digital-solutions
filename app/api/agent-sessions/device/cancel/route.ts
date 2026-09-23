import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { cancelAgentDeviceAuthorization } from "@/apps/web/agent-sessions/device-authorization";
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
    if (!runtime.AGENT_ACCOUNT_SESSION_ENABLED) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);
    const input = schema.parse(await request.json());

    if (!(await rateLimit(`agent-session:cancel:${clientIp(request)}`, 120, 3600)).allowed) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    await db.$transaction(
      (tx) => cancelAgentDeviceAuthorization(tx, {
        deviceCode: input.device_code,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      }),
      { isolationLevel: "Serializable" },
    );

    return NextResponse.json(
      { status: "cancelled" },
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

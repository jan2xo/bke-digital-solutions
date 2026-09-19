import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { startAgentDeviceAuthorization } from "@/apps/web/agent-sessions/device-authorization";
import { getWebHostEnvironment } from "@/apps/web/config/environment";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";
import { db } from "@/platform/host/db";

const schema = z.object({
  device_id: z.string().min(16).max(256),
  device_name: z.string().trim().min(1).max(128).optional(),
  platform: z.enum(["windows", "macos", "linux"]),
  architecture: z.enum(["x64", "arm64", "x86"]),
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

    const ip = clientIp(request);
    if (!(await rateLimit(`agent-session:start:${ip}`, 30, 3600)).allowed) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    if (
      !(await rateLimit(
        `agent-session:start:device:${input.device_id.slice(-16)}`,
        10,
        3600,
      )).allowed
    ) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const { appUrl } = getWebHostEnvironment();
    const started = await db.$transaction(
      (tx) => startAgentDeviceAuthorization(tx, {
        deviceId: input.device_id,
        deviceName: input.device_name,
        platform: input.platform,
        architecture: input.architecture,
        verificationBaseUrl: appUrl,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      }),
      { isolationLevel: "Serializable" },
    );

    return NextResponse.json({
      device_code: started.deviceCode,
      user_code: started.userCode,
      verification_uri: started.verificationUri,
      expires_in: started.expiresIn,
      interval: started.interval,
    }, {
      status: 201,
      headers: {
        "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

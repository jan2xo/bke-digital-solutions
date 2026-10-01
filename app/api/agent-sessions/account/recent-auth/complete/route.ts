import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import {
  authenticateNativeAgentRequest,
  verifyNativeMfaProof,
} from "@/apps/web/agent-sessions/native-mfa";
import {
  markAgentSessionRecentlyAuthenticated,
} from "@/apps/web/agent-sessions/recent-auth";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  challenge_token: z.string().min(16).max(512),
  code: z.string().min(6).max(32),
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

export async function POST(request: Request) {
  try {
    if (!getRuntimeEnvironment().AGENT_ACCOUNT_SESSION_ENABLED) {
      return NextResponse.json(
        { error: "NOT_FOUND" },
        { status: 404 },
      );
    }

    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);
    const input = schema.parse(await request.json());

    const authenticated =
      await authenticateNativeAgentRequest(request);
    if (authenticated.status !== "authenticated") {
      return response({ error: "INVALID_TOKEN" }, 401);
    }

    if (!(await rateLimit(
      `agent-recent-auth-complete:${authenticated.userId}:${authenticated.deviceId}:${clientIp(request)}`,
      10,
      900,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const proof = await verifyNativeMfaProof(
      authenticated.userId,
      input.challenge_token,
      input.code,
    );
    if (proof.status === "invalid") {
      return response({ error: proof.code }, 401);
    }
    if (proof.status === "failed") {
      return response({ error: "MFA_UNAVAILABLE" }, 503);
    }

    const recent = await markAgentSessionRecentlyAuthenticated({
      ...authenticated,
      method: "PASSWORD_MFA",
    });
    return response({
      status: "verified",
      recent_authenticated_until:
        recent.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return apiError(error);
  }
}

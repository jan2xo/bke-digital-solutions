import { NextResponse } from "next/server";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateNativeAgentRequest } from "@/apps/web/agent-sessions/native-mfa";
import { apiError } from "@/apps/web/http/api-error";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: {
    "cache-control": "no-store",
    "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  }});
}

export async function GET(request: Request) {
  try {
    if (!getRuntimeEnvironment().AGENT_ACCOUNT_SESSION_ENABLED) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);
    const authenticated = await authenticateNativeAgentRequest(request);
    if (authenticated.status !== "authenticated") return response({ error: "INVALID_TOKEN" }, 401);

    const [method, remaining] = await Promise.all([
      db.administratorMfaMethod.findUnique({
        where: { userId: authenticated.userId },
        select: { enabledAt: true, pendingExpiresAt: true, disabledAt: true },
      }),
      db.administratorRecoveryCode.count({
        where: { userId: authenticated.userId, usedAt: null },
      }),
    ]);
    return response({
      enabled: Boolean(method?.enabledAt),
      enrollment_pending: Boolean(
        !method?.enabledAt && method?.pendingExpiresAt && method.pendingExpiresAt > new Date()
      ),
      recovery_codes_remaining: method?.enabledAt ? remaining : 0,
    });
  } catch (error) {
    return apiError(error);
  }
}

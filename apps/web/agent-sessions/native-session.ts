import "server-only";

import { authenticateAgentAccessToken } from "@/apps/web/agent-sessions/device-authorization";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

export function nativeAgentBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

export async function authenticateNativeAgentRequest(request: Request) {
  const accessToken = nativeAgentBearerToken(request);
  if (!accessToken) return { status: "invalid_token" as const };

  const runtime = getRuntimeEnvironment();
  return db.$transaction((tx) =>
    authenticateAgentAccessToken(tx, {
      accessToken,
      pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
    }),
  );
}

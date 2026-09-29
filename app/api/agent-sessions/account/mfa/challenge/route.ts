import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import {
  authenticateNativeAgentRequest,
  verifyNativeCurrentPassword,
} from "@/apps/web/agent-sessions/native-mfa";
import { issueIdentityLoginMfaChallenge } from "@/apps/web/auth/mfa-challenge";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({ current_password: z.string().min(1).max(128) }).strict();
function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: {
    "cache-control": "no-store",
    "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  }});
}

export async function POST(request: Request) {
  try {
    if (!getRuntimeEnvironment().AGENT_ACCOUNT_SESSION_ENABLED) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);
    const input = schema.parse(await request.json());
    const authenticated = await authenticateNativeAgentRequest(request);
    if (authenticated.status !== "authenticated") return response({ error: "INVALID_TOKEN" }, 401);
    if (!(await rateLimit(`native-mfa-proof:${authenticated.userId}:${clientIp(request)}`, 5, 900)).allowed) return response({ error: "RATE_LIMITED" }, 429);
    const password = await verifyNativeCurrentPassword(authenticated.userId, input.current_password);
    if (password === "invalid") return response({ error: "INVALID_CREDENTIALS" }, 401);
    if (password === "provider_unavailable") return response({ error: "PASSWORD_PROVIDER_UNAVAILABLE" }, 503);
    const challenge = await issueIdentityLoginMfaChallenge(authenticated.userId);
    return response({
      status: "mfa_challenge_issued",
      challenge_token: challenge.token,
      expires_at: challenge.expiresAt.toISOString(),
      email_sent: challenge.delivered,
      mfa_reference: challenge.reference,
    }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return response({ error: "INVALID_INPUT" }, 400);
    return apiError(error);
  }
}

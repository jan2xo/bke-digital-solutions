import { NextResponse } from "next/server";
import { z } from "zod";
import {
  IDENTITY_MFA_ENROLLMENT_COMPLETION_CAPABILITY_ID,
  type IdentityMfaEnrollmentCompletionCapability,
} from "@bke/identity/contracts/mfa-enrollment-completion.contract";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import {
  authenticateNativeAgentRequest,
  revokeNativeAgentSessionsForUser,
  verifyNativeCurrentPassword,
} from "@/apps/web/agent-sessions/native-mfa";
import { apiError } from "@/apps/web/http/api-error";
import { getV2WebApplication } from "@/apps/web/runtime";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  current_password: z.string().min(1).max(128),
  challenge_token: z.string().min(16).max(512),
  code: z.string().min(6).max(32),
}).strict();
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
    const password = await verifyNativeCurrentPassword(authenticated.userId, input.current_password);
    if (password === "invalid") return response({ error: "INVALID_CREDENTIALS" }, 401);
    if (password === "provider_unavailable") return response({ error: "PASSWORD_PROVIDER_UNAVAILABLE" }, 503);

    const application = await getV2WebApplication();
    const completion = application.get<IdentityMfaEnrollmentCompletionCapability>(IDENTITY_MFA_ENROLLMENT_COMPLETION_CAPABILITY_ID);
    const result = await completion.complete({
      userId: authenticated.userId,
      challengeToken: input.challenge_token,
      code: input.code,
    });
    if (result.status === "INVALID") return response({ error: result.code }, 401);
    if (result.status === "FAILED") return response({ error: "MFA_UNAVAILABLE" }, 503);

    await revokeNativeAgentSessionsForUser(authenticated.userId);
    return response({
      status: "mfa_enabled",
      recovery_codes: result.recoveryCodes,
      reauthentication_required: true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return response({ error: "INVALID_INPUT" }, 400);
    return apiError(error);
  }
}

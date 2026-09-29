import { NextResponse } from "next/server";
import { z } from "zod";
import {
  IDENTITY_MFA_ENROLLMENT_START_CAPABILITY_ID,
  type IdentityMfaEnrollmentStartCapability,
} from "@bke/identity/contracts/mfa-enrollment-start.contract";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import {
  authenticateNativeAgentRequest,
  verifyNativeCurrentPassword,
} from "@/apps/web/agent-sessions/native-mfa";
import { deliverIdentityMfaChallenge } from "@/apps/web/auth/mfa-challenge";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getV2WebApplication } from "@/apps/web/runtime";
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
    if (!(await rateLimit(`native-mfa-enroll:${authenticated.userId}:${clientIp(request)}`, 5, 900)).allowed) return response({ error: "RATE_LIMITED" }, 429);
    const password = await verifyNativeCurrentPassword(authenticated.userId, input.current_password);
    if (password === "invalid") return response({ error: "INVALID_CREDENTIALS" }, 401);
    if (password === "provider_unavailable") return response({ error: "PASSWORD_PROVIDER_UNAVAILABLE" }, 503);

    const application = await getV2WebApplication();
    const enrollment = application.get<IdentityMfaEnrollmentStartCapability>(IDENTITY_MFA_ENROLLMENT_START_CAPABILITY_ID);
    const result = await enrollment.start({ userId: authenticated.userId });
    if (result.status === "REJECTED") return response({ error: result.code }, result.code === "MFA_ALREADY_ENABLED" ? 409 : 403);
    if (result.status === "FAILED") return response({ error: "MFA_UNAVAILABLE" }, 503);
    const delivered = await deliverIdentityMfaChallenge({
      userId: authenticated.userId,
      purpose: "ENROLLMENT",
      delivery: result.delivery,
    });
    return response({
      status: "enrollment_challenge_issued",
      challenge_token: result.challengeToken,
      expires_at: result.expiresAt.toISOString(),
      email_sent: delivered,
      mfa_reference: result.delivery.reference,
    }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return response({ error: "INVALID_INPUT" }, 400);
    return apiError(error);
  }
}

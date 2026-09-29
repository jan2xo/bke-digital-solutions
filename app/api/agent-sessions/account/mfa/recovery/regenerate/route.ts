import { NextResponse } from "next/server";
import { z } from "zod";
import {
  IDENTITY_MFA_RECOVERY_REGENERATION_CAPABILITY_ID,
  type IdentityMfaRecoveryRegenerationCapability,
} from "@bke/identity/contracts/mfa-recovery-regeneration.contract";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import {
  authenticateNativeAgentRequest,
  issueTransientNativeMfaSession,
  revokeNativeAgentSessionsForUser,
  verifyNativeCurrentPassword,
  verifyNativeMfaProof,
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
    const proof = await verifyNativeMfaProof(authenticated.userId, input.challenge_token, input.code);
    if (proof.status === "invalid") return response({ error: proof.code }, 401);
    if (proof.status === "failed") return response({ error: "MFA_UNAVAILABLE" }, 503);

    await revokeNativeAgentSessionsForUser(authenticated.userId);
    const transient = await issueTransientNativeMfaSession(
      authenticated.userId,
      proof.authenticationMethod,
    );
    if (transient.status !== "issued") return response({ error: "MFA_UNAVAILABLE" }, 503);

    const application = await getV2WebApplication();
    const regeneration = application.get<IdentityMfaRecoveryRegenerationCapability>(
      IDENTITY_MFA_RECOVERY_REGENERATION_CAPABILITY_ID,
    );
    const result = await regeneration.regenerate({ sessionToken: transient.token });
    if (result.status === "INVALID") return response({ error: result.code }, 409);
    if (result.status === "FAILED") return response({ error: "MFA_UNAVAILABLE" }, 503);
    return response({
      status: "recovery_codes_regenerated",
      recovery_codes: result.recoveryCodes,
      reauthentication_required: true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return response({ error: "INVALID_INPUT" }, 400);
    return apiError(error);
  }
}

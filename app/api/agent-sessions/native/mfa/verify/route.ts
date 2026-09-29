import { NextResponse } from "next/server";
import { z } from "zod";
import {
  IDENTITY_LOOKUP_CAPABILITY_ID,
  type IdentityLookupCapability,
} from "@bke/identity/contracts/identity.contract";
import {
  IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID,
  type IdentityLoginMfaVerificationCapability,
} from "@bke/identity/contracts/login-mfa-verification.contract";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { completeNativeBkeHandoff } from "@/apps/web/agent-sessions/native-mfa";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getV2WebApplication } from "@/apps/web/runtime";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  challenge_token: z.string().min(16).max(512),
  code: z.string().min(6).max(32),
  customer_account_id: z.string().min(1).max(256).optional(),
  device_id: z.string().regex(/^[A-Za-z0-9._:-]{16,256}$/),
  device_name: z.string().trim().min(1).max(128).optional(),
  platform: z.enum(["windows", "macos", "linux"]),
  architecture: z.enum(["x64", "arm64", "x86"]),
}).strict();

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: {
    "cache-control": "no-store",
    "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  }});
}

export async function POST(request: Request) {
  try {
    if (!getRuntimeEnvironment().AGENT_ACCOUNT_SESSION_ENABLED) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);
    const input = schema.parse(await request.json());
    if (!(await rateLimit(`native-mfa-verify:${clientIp(request)}:${input.device_id.slice(-16)}`, 10, 900)).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const application = await getV2WebApplication();
    const verification = application.get<IdentityLoginMfaVerificationCapability>(
      IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID,
    );
    const verified = await verification.verify({
      challengeToken: input.challenge_token,
      code: input.code,
    });
    if (verified.status === "INVALID") {
      return response({ error: verified.code === "INVALID_CHALLENGE" ? "INVALID_MFA_CHALLENGE" : "INVALID_MFA_CODE" }, 401);
    }
    if (verified.status === "FAILED") return response({ error: "MFA_UNAVAILABLE" }, 503);

    const lookup = application.get<IdentityLookupCapability>(IDENTITY_LOOKUP_CAPABILITY_ID);
    const found = await lookup.findById(verified.userId);
    if (found.status !== "FOUND") return response({ error: "INVALID_MFA_CHALLENGE" }, 401);
    const principal = found.principal;
    if (principal.role !== "CUSTOMER") return response({ error: "FORBIDDEN" }, 403);
    if (!principal.emailVerified) return response({ error: "EMAIL_NOT_VERIFIED" }, 403);
    if (principal.lifecycleState !== "ACTIVE") return response({ error: "ACCOUNT_NOT_ACTIVE" }, 403);

    const result = await completeNativeBkeHandoff(principal, {
      customerAccountId: input.customer_account_id,
      deviceId: input.device_id,
      deviceName: input.device_name,
      platform: input.platform,
      architecture: input.architecture,
    });
    if (result.status === "account_selection_required") {
      return response({
        status: result.status,
        accounts: result.accounts.map((account) => ({
          account_id: account.id,
          account_type: account.type,
          account_display_name: account.displayName,
        })),
      });
    }
    return response({
      status: "handoff_issued",
      handoff_code: result.handoff.handoffCode,
      expires_in: result.handoff.expiresIn,
      authentication_method: verified.authenticationMethod,
      account: {
        account_id: result.handoff.account.id,
        account_type: result.handoff.account.type,
        account_display_name: result.handoff.account.displayName,
      },
    }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return response({ error: "INVALID_INPUT" }, 400);
    return apiError(error);
  }
}

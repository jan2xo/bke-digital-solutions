import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/v2/apps/web/auth/session";
import {
  IDENTITY_MFA_CHALLENGE_COOKIE,
  verifyIdentityLoginMfaChallenge,
} from "@/v2/apps/web/auth/mfa-challenge";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { securityEvent } from "@/v2/apps/web/security/events";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!(await rateLimit(`admin-mfa:${clientIp(request)}`, 8, 900)).allowed) {
      await securityEvent("SECURITY_RATE_LIMIT_TRIGGERED", request, undefined, { reason: "mfa" });
      throw new Error("RATE_LIMITED");
    }
    const { code } = z.object({ code: z.string().min(6).max(32) }).parse(await request.json());
    const verified = await verifyIdentityLoginMfaChallenge(code);
    const session = await createSession(verified.userId, request, {
      mfaVerified: true,
      recent: true,
      authenticationMethod: verified.authenticationMethod,
    });
    const result = { ...verified, sessionId: session.id };
    await securityEvent(
      result.recoveryUsed ? "MFA_RECOVERY_USED" : "MFA_CHALLENGE_SUCCEEDED",
      request,
      result.userId,
      undefined,
      { sessionId: result.sessionId, authenticationMethod: result.authenticationMethod },
    );
    await securityEvent("ADMIN_LOGIN_SUCCEEDED", request, result.userId, undefined, {
      sessionId: result.sessionId,
      authenticationMethod: result.authenticationMethod,
    });
    await securityEvent("ADMIN_SESSION_CREATED", request, result.userId, undefined, {
      sessionId: result.sessionId,
      authenticationMethod: result.authenticationMethod,
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(IDENTITY_MFA_CHALLENGE_COOKIE);
    return response;
  } catch (error) {
    if (!(error instanceof Error && error.message === "INVALID_MFA_CODE")) {
      await securityEvent("MFA_CHALLENGE_FAILED", request).catch(() => undefined);
    }
    return apiError(error);
  }
}

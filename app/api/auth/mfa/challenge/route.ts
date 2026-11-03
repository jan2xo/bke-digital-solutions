import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/apps/web/auth/session";
import {
  IDENTITY_MFA_CHALLENGE_COOKIE,
  verifyIdentityLoginMfaChallenge,
} from "@/apps/web/auth/mfa-challenge";
import { apiError } from "@/apps/web/http/api-error";
import { assertSameOrigin, clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { securityEvent } from "@/apps/web/security/events";
import { pendingReacceptance } from "@/apps/web/legal/service";
import { db } from "@/platform/host/db";
import { safeLocalRedirect } from "@/apps/web/security/redirect";

const GOOGLE_MFA_METHODS = new Set([
  "GOOGLE_OIDC_EMAIL_OTP",
  "GOOGLE_OIDC_RECOVERY",
]);

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!(await rateLimit(`login-mfa:${clientIp(request)}`, 8, 900)).allowed) {
      await securityEvent("SECURITY_RATE_LIMIT_TRIGGERED", request, undefined, { reason: "mfa" });
      throw new Error("RATE_LIMITED");
    }

    const { code, returnTo } = z
      .object({ code: z.string().min(6).max(32), returnTo: z.string().max(2048).optional() })
      .strict()
      .parse(await request.json());
    const verified = await verifyIdentityLoginMfaChallenge(code);
    if (!GOOGLE_MFA_METHODS.has(verified.authenticationMethod)) {
      await securityEvent("MFA_CHALLENGE_FAILED", request, verified.userId, undefined, {
        reason: "GOOGLE_AUTH_REQUIRED",
        authenticationMethod: verified.authenticationMethod,
      }).catch(() => undefined);
      const response = NextResponse.json(
        { error: "GOOGLE_SIGN_IN_REQUIRED" },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
      response.cookies.delete(IDENTITY_MFA_CHALLENGE_COOKIE);
      return response;
    }

    const principal = await db.user.findUnique({
      where: { id: verified.userId },
      select: { role: true, lifecycleState: true, suspendedAt: true },
    });
    if (!principal || principal.lifecycleState !== "ACTIVE" || principal.suspendedAt) {
      throw new Error("UNAUTHENTICATED");
    }

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

    if (principal.role === "ADMIN") {
      await securityEvent("ADMIN_LOGIN_SUCCEEDED", request, result.userId, undefined, {
        sessionId: result.sessionId,
        authenticationMethod: result.authenticationMethod,
      });
      await securityEvent("ADMIN_SESSION_CREATED", request, result.userId, undefined, {
        sessionId: result.sessionId,
        authenticationMethod: result.authenticationMethod,
      });
    }

    const safeReturnTo = safeLocalRedirect(returnTo);
    const redirectTo =
      principal.role === "ADMIN"
        ? "/admin"
        : (await pendingReacceptance(result.userId)).length > 0
          ? `/legal/accept?returnTo=${encodeURIComponent(safeReturnTo)}`
          : safeReturnTo;

    const response = NextResponse.json({ ok: true, redirectTo });
    response.cookies.delete(IDENTITY_MFA_CHALLENGE_COOKIE);
    return response;
  } catch (error) {
    if (!(error instanceof Error && error.message === "INVALID_MFA_CODE")) {
      await securityEvent("MFA_CHALLENGE_FAILED", request).catch(() => undefined);
    }
    return apiError(error);
  }
}

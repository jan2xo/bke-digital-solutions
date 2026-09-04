import { NextResponse } from "next/server";
import { z } from "zod";
import {
  IDENTITY_MFA_ENROLLMENT_COMPLETION_CAPABILITY_ID,
  type IdentityMfaEnrollmentCompletionCapability,
} from "@bke/identity/contracts/mfa-enrollment-completion.contract";
import { createSession } from "@/lib/auth";
import { currentIdentitySession } from "@/v2/apps/web/auth/session";
import {
  currentIdentityMfaChallengeToken,
  IDENTITY_MFA_CHALLENGE_COOKIE,
  IdentityCapabilityError,
} from "@/v2/apps/web/auth/mfa-challenge";
import { getV2WebApplication } from "@/v2/apps/web/runtime";
import { apiError } from "@/v2/apps/web/http/api-error";
import { securityEvent } from "@/lib/security/events";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await currentIdentitySession();
    if (!session) throw new Error("UNAUTHENTICATED");
    if (session.principal.role !== "ADMIN") throw new Error("FORBIDDEN");
    if (
      !session.session.recentAuthenticatedAt ||
      session.session.recentAuthenticatedAt < new Date(Date.now() - 15 * 60_000)
    ) {
      throw new Error("RECENT_AUTH_REQUIRED");
    }
    if (!(await rateLimit(`mfa-enroll-verify:${session.principal.id}:${clientIp(request)}`, 8, 900)).allowed) {
      throw new Error("RATE_LIMITED");
    }

    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(await request.json());
    const challengeToken = await currentIdentityMfaChallengeToken();
    if (!challengeToken) throw new Error("INVALID_MFA_CHALLENGE");

    const application = await getV2WebApplication();
    const completion = application.get<IdentityMfaEnrollmentCompletionCapability>(
      IDENTITY_MFA_ENROLLMENT_COMPLETION_CAPABILITY_ID,
    );
    const result = await completion.complete({
      userId: session.principal.id,
      challengeToken,
      code,
    });
    if (result.status === "INVALID") {
      if (result.code === "INVALID_CHALLENGE") throw new Error("INVALID_MFA_CHALLENGE");
      throw new Error("INVALID_MFA_CODE");
    }
    if (result.status === "FAILED") throw new IdentityCapabilityError(result.code);

    await createSession(session.principal.id, request, {
      mfaVerified: true,
      recent: true,
      authenticationMethod: "PASSWORD_EMAIL_OTP",
    });
    await securityEvent("MFA_ENROLLED", request, session.principal.id, { method: "email" });

    const response = NextResponse.json({ ok: true, recoveryCodes: result.recoveryCodes });
    response.cookies.delete(IDENTITY_MFA_CHALLENGE_COOKIE);
    return response;
  } catch (error) {
    return apiError(error);
  }
}

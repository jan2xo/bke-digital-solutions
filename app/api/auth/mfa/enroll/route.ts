import { NextResponse } from "next/server";
import {
  IDENTITY_MFA_ENROLLMENT_START_CAPABILITY_ID,
  type IdentityMfaEnrollmentStartCapability,
} from "@bke/identity/contracts/mfa-enrollment-start.contract";
import { currentIdentitySession } from "@/v2/apps/web/auth/session";
import {
  deliverIdentityMfaChallenge,
  IDENTITY_MFA_CHALLENGE_COOKIE,
  IDENTITY_MFA_CHALLENGE_COOKIE_OPTIONS,
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
    if (!(await rateLimit(`mfa-enroll:${session.principal.id}:${clientIp(request)}`, 5, 900)).allowed) {
      throw new Error("RATE_LIMITED");
    }

    const application = await getV2WebApplication();
    const enrollment = application.get<IdentityMfaEnrollmentStartCapability>(
      IDENTITY_MFA_ENROLLMENT_START_CAPABILITY_ID,
    );
    const result = await enrollment.start({ userId: session.principal.id });
    if (result.status === "REJECTED") {
      throw new Error(result.code === "PRINCIPAL_NOT_FOUND" ? "UNAUTHENTICATED" : result.code);
    }
    if (result.status === "FAILED") throw new IdentityCapabilityError(result.code);

    const delivered = await deliverIdentityMfaChallenge({
      userId: session.principal.id,
      purpose: "ENROLLMENT",
      delivery: result.delivery,
    });
    await securityEvent("MFA_ENROLLMENT_STARTED", request, session.principal.id, { method: "email" });

    const response = NextResponse.json({ ok: true, emailSent: delivered });
    response.cookies.set(
      IDENTITY_MFA_CHALLENGE_COOKIE,
      result.challengeToken,
      IDENTITY_MFA_CHALLENGE_COOKIE_OPTIONS,
    );
    return response;
  } catch (error) {
    return apiError(error);
  }
}

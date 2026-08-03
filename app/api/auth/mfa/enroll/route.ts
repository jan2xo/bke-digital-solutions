import { NextResponse } from "next/server";
import { ADMIN_EMAIL_CHALLENGE_COOKIE, ADMIN_EMAIL_CHALLENGE_COOKIE_OPTIONS, createEmailChallenge } from "@/lib/admin-mfa";
import { requireAdminEnrollmentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { securityEvent } from "@/lib/security/events";
import { rateLimit } from "@/lib/security/rate-limit";
import { assertSameOrigin, clientIp } from "@/lib/security/request";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireAdminEnrollmentSession();
    if (!session.recentAuthenticatedAt || session.recentAuthenticatedAt < new Date(Date.now() - 15 * 60_000)) throw new Error("RECENT_AUTH_REQUIRED");
    if (!(await rateLimit(`mfa-enroll:${session.userId}:${clientIp(request)}`, 5, 900)).allowed) throw new Error("RATE_LIMITED");
    if (session.user.administratorMfa?.enabledAt) throw new Error("MFA_ALREADY_ENABLED");
    await db.administratorMfaMethod.upsert({ where: { userId: session.userId }, create: { userId: session.userId, encryptedSecret: null, pendingExpiresAt: new Date(Date.now() + 10 * 60_000) }, update: { encryptedSecret: null, pendingExpiresAt: new Date(Date.now() + 10 * 60_000), enabledAt: null, verifiedAt: null, disabledAt: null } });
    const challenge = await createEmailChallenge(session.userId, "ENROLLMENT");
    await securityEvent("MFA_ENROLLMENT_STARTED", request, session.userId, { method: "email" });
    const response=NextResponse.json({ok:true,emailSent:challenge.delivered});response.cookies.set(ADMIN_EMAIL_CHALLENGE_COOKIE,challenge.token,ADMIN_EMAIL_CHALLENGE_COOKIE_OPTIONS);return response;
  } catch (error) { return apiError(error); }
}

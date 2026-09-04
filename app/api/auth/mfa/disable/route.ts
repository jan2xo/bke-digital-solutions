import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { createSession, requireRecentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/v2/apps/web/http/api-error";
import { securityEvent } from "@/lib/security/events";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireRecentSession();
    if (session.user.role !== "ADMIN" || !session.mfaVerifiedAt || !session.user.administratorMfa?.enabledAt) throw new Error("FORBIDDEN");
    if (!(await rateLimit(`mfa-disable:${session.userId}:${clientIp(request)}`, 3, 3600)).allowed) throw new Error("RATE_LIMITED");
    await db.$transaction(async (tx) => {
      await tx.administratorMfaMethod.update({ where: { userId: session.userId }, data: { enabledAt: null, disabledAt: new Date(), pendingExpiresAt: null } });
      await tx.administratorRecoveryCode.deleteMany({ where: { userId: session.userId } });
      await tx.mfaChallenge.deleteMany({ where: { userId: session.userId } });
      await tx.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date(), revocationReason: "MFA_DISABLED" } });
    });
    await createSession(session.userId, request, { recent: true, authenticationMethod: "MFA_ENROLLMENT" });
    await securityEvent("MFA_DISABLED", request, session.userId);
    await audit({ actorId: session.userId, action: "MFA_DISABLED", targetType: "User", targetId: session.userId });
    return NextResponse.json({ enrollmentRequired: true });
  } catch (error) { return apiError(error); }
}

import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { createSession, requireRecentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { securityEvent } from "@/lib/security/events";
import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/security/mfa";
import { rateLimit } from "@/lib/security/rate-limit";
import { assertSameOrigin, clientIp } from "@/lib/security/request";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireRecentSession();
    if (session.user.role !== "ADMIN" || !session.mfaVerifiedAt || !session.user.administratorMfa?.enabledAt) throw new Error("FORBIDDEN");
    if (!(await rateLimit(`mfa-recovery-regenerate:${session.userId}:${clientIp(request)}`, 3, 3600)).allowed) throw new Error("RATE_LIMITED");
    const codes = generateRecoveryCodes();
    await db.$transaction(async (tx) => {
      await tx.administratorRecoveryCode.deleteMany({ where: { userId: session.userId } });
      await tx.administratorRecoveryCode.createMany({ data: codes.map((code) => ({ userId: session.userId, codeHash: hashRecoveryCode(code) })) });
      await tx.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date(), revocationReason: "RECOVERY_CODES_REGENERATED" } });
    });
    await createSession(session.userId, request, { mfaVerified: true, recent: true, authenticationMethod: "PASSWORD_EMAIL_OTP" });
    await securityEvent("MFA_RECOVERY_REGENERATED", request, session.userId);
    await audit({ actorId: session.userId, action: "MFA_RECOVERY_REGENERATED", targetType: "User", targetId: session.userId });
    return NextResponse.json({ recoveryCodes: codes });
  } catch (error) { return apiError(error); }
}

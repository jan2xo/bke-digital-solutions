import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, requireAdminEnrollmentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { securityEvent } from "@/lib/security/events";
import { decryptMfaSecret, generateRecoveryCodes, hashRecoveryCode, verifyTotp } from "@/lib/security/mfa";
import { rateLimit } from "@/lib/security/rate-limit";
import { assertSameOrigin, clientIp } from "@/lib/security/request";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireAdminEnrollmentSession();
    if (!session.recentAuthenticatedAt || session.recentAuthenticatedAt < new Date(Date.now() - 15 * 60_000)) throw new Error("RECENT_AUTH_REQUIRED");
    if (!(await rateLimit(`mfa-enroll-verify:${session.userId}:${clientIp(request)}`, 8, 900)).allowed) throw new Error("RATE_LIMITED");
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(await request.json());
    const method = await db.administratorMfaMethod.findUnique({ where: { userId: session.userId } });
    if (!method || method.enabledAt || !method.pendingExpiresAt || method.pendingExpiresAt < new Date() || !verifyTotp(decryptMfaSecret(method.encryptedSecret), code)) throw new Error("INVALID_MFA_CODE");
    const codes = generateRecoveryCodes();
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.administratorMfaMethod.update({ where: { userId: session.userId }, data: { enabledAt: now, verifiedAt: now, disabledAt: null, pendingExpiresAt: null } });
      await tx.administratorRecoveryCode.deleteMany({ where: { userId: session.userId } });
      await tx.administratorRecoveryCode.createMany({ data: codes.map((value) => ({ userId: session.userId, codeHash: hashRecoveryCode(value) })) });
      await tx.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date(), revocationReason: "MFA_ENROLLED" } });
    });
    await createSession(session.userId, request, { mfaVerified: true, recent: true, authenticationMethod: "PASSWORD_TOTP" });
    await securityEvent("MFA_ENROLLED", request, session.userId);
    return NextResponse.json({ ok: true, recoveryCodes: codes });
  } catch (error) { return apiError(error); }
}

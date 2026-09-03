import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminEnrollmentSession, createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/v2/apps/web/http/api-error";
import { hashRecoveryCode } from "@/lib/security/mfa";
import { tokenHash } from "@/lib/emergency-mfa";
import { generateRecoveryCodes } from "@/lib/security/mfa";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireAdminEnrollmentSession();
    if (!session.recentAuthenticatedAt || session.recentAuthenticatedAt < new Date(Date.now() - 15 * 60_000)) throw new Error("RECENT_AUTH_REQUIRED");
    if (!(await rateLimit(`mfa-emergency-enroll:${session.userId}:${clientIp(request)}`, 5, 900)).allowed) throw new Error("RATE_LIMITED");
    const { token } = z.object({ token: z.string().min(40).max(256) }).parse(await request.json());
    const authorization = await db.emergencyMfaEnrollmentAuthorization.findFirst({ where: { userId: session.userId, tokenHash: tokenHash(token), consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (!authorization) throw new Error("INVALID_EMERGENCY_ENROLLMENT");
    const codes = generateRecoveryCodes(); const now = new Date();
    await db.$transaction(async (tx) => {
      const consumed = await tx.emergencyMfaEnrollmentAuthorization.updateMany({ where: { id: authorization.id, consumedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (consumed.count !== 1) throw new Error("INVALID_EMERGENCY_ENROLLMENT");
      await tx.administratorMfaMethod.upsert({ where: { userId: session.userId }, create: { userId: session.userId, encryptedSecret: null, enabledAt: now, verifiedAt: now, pendingExpiresAt: null }, update: { encryptedSecret: null, enabledAt: now, verifiedAt: now, pendingExpiresAt: null, disabledAt: null } });
      await tx.administratorRecoveryCode.deleteMany({ where: { userId: session.userId } });
      await tx.administratorRecoveryCode.createMany({ data: codes.map(code => ({ userId: session.userId, codeHash: hashRecoveryCode(code) })) });
      await tx.mfaChallenge.deleteMany({ where: { userId: session.userId } });
      await tx.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: now, revocationReason: "MFA_EMERGENCY_ENROLLED" } });
      await tx.auditLog.create({ data: { action: "ADMIN_EMERGENCY_MFA_ENROLLMENT_COMPLETED", targetType: "User", targetId: session.userId, metadata: { authorizationId: authorization.id, ownerKeyVersion: authorization.ownerKeyVersion, recoveryMethod: "DEPLOYMENT_OPERATOR", deploymentEnvironment: authorization.deploymentEnvironment } } });
    });
    await createSession(session.userId, request, { mfaVerified: true, recent: true, authenticationMethod: "MFA_ENROLLMENT" });
    return NextResponse.json({ ok: true, recoveryCodes: codes });
  } catch (error) { return apiError(error); }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { securityEvent } from "@/lib/security/events";
import { decryptMfaSecret, hashRecoveryCode, verifyTotp } from "@/lib/security/mfa";
import { rateLimit } from "@/lib/security/rate-limit";
import { assertSameOrigin, clientIp } from "@/lib/security/request";

const schema = z.object({ password: z.string().min(1).max(128), code: z.string().min(6).max(32).optional() });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await currentSession();
    if (!session) throw new Error("UNAUTHENTICATED");
    if (!(await rateLimit(`recent:${session.userId}:${clientIp(request)}`, 5, 900)).allowed) throw new Error("RATE_LIMITED");
    const { password, code } = schema.parse(await request.json());
    const credential = await db.passwordCredential.findUnique({ where: { userId: session.userId } });
    let secondFactorValid = session.user.role !== "ADMIN";
    let recoveryId: string | undefined;
    if (session.user.role === "ADMIN") {
      const method = await db.administratorMfaMethod.findUnique({ where: { userId: session.userId } });
      if (method?.enabledAt && code) {
        secondFactorValid = verifyTotp(decryptMfaSecret(method.encryptedSecret), code);
        if (!secondFactorValid) {
          const recovery = await db.administratorRecoveryCode.findFirst({ where: { userId: session.userId, codeHash: hashRecoveryCode(code), usedAt: null }, select: { id: true } });
          recoveryId = recovery?.id;
          secondFactorValid = Boolean(recovery);
        }
      }
    }
    if (!credential || !(await verifyPassword(credential.passwordHash, password)) || !secondFactorValid) {
      await securityEvent("RECENT_AUTH_FAILED", request, session.userId);
      throw new Error("INVALID_CREDENTIALS");
    }
    await db.$transaction(async (tx) => {
      if (recoveryId) {
        const used = await tx.administratorRecoveryCode.updateMany({ where: { id: recoveryId, usedAt: null }, data: { usedAt: new Date() } });
        if (used.count !== 1) throw new Error("INVALID_CREDENTIALS");
      }
      await tx.session.update({ where: { id: session.id }, data: { recentAuthenticatedAt: new Date(), assuranceLevel: "RECENTLY_AUTHENTICATED" } });
    });
    if (recoveryId) await securityEvent("MFA_RECOVERY_USED", request, session.userId, undefined, { sessionId: session.id, authenticationMethod: "PASSWORD_RECOVERY" });
    await securityEvent("RECENT_AUTH_SUCCEEDED", request, session.userId, undefined, { sessionId: session.id, authenticationMethod: recoveryId ? "PASSWORD_RECOVERY" : session.user.role === "ADMIN" ? "PASSWORD_TOTP" : "PASSWORD" });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { createSession, hashPassword, requireRecentSession, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/v2/apps/web/http/api-error";
import { securityEvent } from "@/lib/security/events";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { passwordSchema } from "@/v2/apps/web/http/validation";

const schema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema });
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireRecentSession();
    if (!(await rateLimit(`password-change:${session.userId}:${clientIp(request)}`, 3, 3600)).allowed) throw new Error("RATE_LIMITED");
    const input = schema.parse(await request.json());
    const credential = await db.passwordCredential.findUnique({ where: { userId: session.userId } });
    if (!credential || !(await verifyPassword(credential.passwordHash, input.currentPassword))) throw new Error("INVALID_CREDENTIALS");
    const passwordHash = await hashPassword(input.newPassword);
    await db.$transaction([db.passwordCredential.update({ where: { userId: session.userId }, data: { passwordHash, changedAt: new Date() } }), db.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date(), revocationReason: "PASSWORD_CHANGED" } })]);
    const isAdmin = session.user.role === "ADMIN";
    await createSession(session.userId, request, { mfaVerified: isAdmin, recent: true, authenticationMethod: isAdmin ? "PASSWORD_EMAIL_OTP" : "PASSWORD" });
    await securityEvent("PASSWORD_CHANGED", request, session.userId);
    await audit({ actorId: session.userId, action: "PASSWORD_CHANGED", targetType: "User", targetId: session.userId });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}

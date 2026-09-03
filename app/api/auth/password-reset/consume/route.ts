import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/security/crypto";
import { securityEvent } from "@/lib/security/events";
import { assertSameOrigin } from "@/lib/security/request";
import { passwordSchema } from "@/v2/apps/web/http/validation";

const schema = z.object({ token: z.string().min(20), password: passwordSchema });
export async function POST(request: Request) {
  assertSameOrigin(request);
  const input = schema.parse(await request.json());
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(input.token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 400 });
  const [passwordHash, user] = await Promise.all([hashPassword(input.password), db.user.findUnique({ where: { id: row.userId }, select: { role: true } })]);
  await db.$transaction([
    db.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.passwordCredential.upsert({ where: { userId: row.userId }, create: { userId: row.userId, passwordHash }, update: { passwordHash, changedAt: new Date() } }),
    db.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date(), revocationReason: "PASSWORD_RESET" } }),
  ]);
  if (user?.role === "ADMIN") await securityEvent("PASSWORD_RESET_COMPLETED", request, row.userId);
  return NextResponse.json({ ok: true });
}

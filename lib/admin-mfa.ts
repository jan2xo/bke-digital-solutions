import "server-only";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createSession } from "@/lib/auth";
import { hashToken, randomToken } from "@/lib/security/crypto";
import { decryptMfaSecret, hashRecoveryCode, verifyTotp } from "@/lib/security/mfa";
import { securityEvent } from "@/lib/security/events";

const COOKIE = env.NODE_ENV === "production" ? "__Host-bke_mfa_challenge" : "bke_mfa_challenge";
export async function createLoginChallenge(userId: string) {
  const token = randomToken(); await db.mfaChallenge.deleteMany({ where: { userId, consumedAt: null } });
  await db.mfaChallenge.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 300_000) } });
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 300 });
}
export async function completeLoginChallenge(code: string, request: Request) {
  const jar = await cookies(); const token = jar.get(COOKIE)?.value; if (!token) throw new Error("INVALID_MFA_CHALLENGE");
  const challenge = await db.mfaChallenge.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: { administratorMfa: true } } } });
  if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attemptCount >= 5 || !challenge.user.administratorMfa?.enabledAt) throw new Error("INVALID_MFA_CHALLENGE");
  const validTotp = verifyTotp(decryptMfaSecret(challenge.user.administratorMfa.encryptedSecret), code);
  const recovery = validTotp ? null : await db.administratorRecoveryCode.findFirst({ where: { userId: challenge.userId, codeHash: hashRecoveryCode(code), usedAt: null } });
  if (!validTotp && !recovery) { await db.mfaChallenge.update({ where: { id: challenge.id }, data: { attemptCount: { increment: 1 } } }); await securityEvent("MFA_CHALLENGE_FAILED", request, challenge.userId); throw new Error("INVALID_MFA_CODE"); }
  await db.$transaction(async tx => { const consumed=await tx.mfaChallenge.updateMany({where:{id:challenge.id,consumedAt:null,attemptCount:{lt:5}},data:{consumedAt:new Date()}});if(consumed.count!==1)throw new Error("INVALID_MFA_CHALLENGE");if(recovery){const used=await tx.administratorRecoveryCode.updateMany({where:{id:recovery.id,usedAt:null},data:{usedAt:new Date()}});if(used.count!==1)throw new Error("INVALID_MFA_CODE");} });
  jar.delete(COOKIE); const method: "PASSWORD_RECOVERY" | "PASSWORD_TOTP" = recovery ? "PASSWORD_RECOVERY" : "PASSWORD_TOTP"; const session=await createSession(challenge.userId, request, { mfaVerified: true, recent: true, authenticationMethod: method }); return { userId: challenge.userId, sessionId: session.id, recoveryUsed: Boolean(recovery), authenticationMethod: method };
}

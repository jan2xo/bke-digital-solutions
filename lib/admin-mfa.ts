import "server-only";
import { cookies } from "next/headers";
import type { MfaChallengePurpose } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createSession } from "@/lib/auth";
import { sendAdministratorLoginCode } from "@/lib/email";
import { hashToken, randomToken } from "@/lib/security/crypto";
import { emailOtpForChallenge, hashEmailOtp, hashRecoveryCode, verifyHashedEmailOtp } from "@/lib/security/mfa";
import { safeEmailFailureCode } from "@/lib/email/failures";
import { audit } from "@/lib/audit";

export const ADMIN_EMAIL_CHALLENGE_COOKIE = env.NODE_ENV === "production" ? "__Host-bke_mfa_challenge" : "bke_mfa_challenge";
const CHALLENGE_TTL_MS = 10 * 60_000;
export const ADMIN_EMAIL_CHALLENGE_COOKIE_OPTIONS = { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", maxAge: CHALLENGE_TTL_MS / 1000 };

export async function createEmailChallenge(userId: string, purpose: MfaChallengePurpose) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, role: true } });
  if (user.role !== "ADMIN") throw new Error("FORBIDDEN");
  const token = randomToken();
  const tokenHash = hashToken(token);
  const code = emailOtpForChallenge(token);
  const reference = tokenHash.slice(0, 6).toUpperCase();
  await db.$transaction(async (tx) => {
    await tx.mfaChallenge.deleteMany({ where: { userId, purpose, consumedAt: null } });
    await tx.mfaChallenge.create({ data: { userId, purpose, tokenHash, codeHash: hashEmailOtp(code), expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) } });
  });
  let delivered=true;
  try { await sendAdministratorLoginCode(user.email, code, reference); }
  catch (error) { delivered=false; await audit({ actorId: userId, action: "EMAIL_DELIVERY_FAILED", targetType: "MfaChallenge", targetId: "delivery", metadata: { provider: "resend", purpose, category: safeEmailFailureCode(error) } }).catch(() => undefined); }
  return {token,delivered,reference};
}

export async function pendingEmailChallenge(purpose: MfaChallengePurpose, userId?: string) {
  const token = (await cookies()).get(ADMIN_EMAIL_CHALLENGE_COOKIE)?.value;
  if (!token) throw new Error("INVALID_MFA_CHALLENGE");
  const challenge = await db.mfaChallenge.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: { administratorMfa: true } } } });
  if (!challenge || challenge.purpose !== purpose || (userId && challenge.userId !== userId) || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attemptCount >= 5 || challenge.user.role !== "ADMIN") throw new Error("INVALID_MFA_CHALLENGE");
  return { challenge, token };
}

export async function validateEmailOrRecoveryCode(code: string, purpose: MfaChallengePurpose, userId?: string) {
  const { challenge } = await pendingEmailChallenge(purpose, userId);
  const validEmailCode = Boolean(challenge.codeHash && verifyHashedEmailOtp(challenge.codeHash, code));
  const recovery = validEmailCode ? null : await db.administratorRecoveryCode.findFirst({ where: { userId: challenge.userId, codeHash: hashRecoveryCode(code), usedAt: null } });
  if (!validEmailCode && !recovery) {
    await db.mfaChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { attemptCount: { increment: 1 } } });
    throw new Error("INVALID_MFA_CODE");
  }
  return { challenge, recovery };
}

export async function consumeValidatedChallenge(challengeId: string, recoveryId?: string) {
  await db.$transaction(async (tx) => {
    const consumed = await tx.mfaChallenge.updateMany({ where: { id: challengeId, consumedAt: null, attemptCount: { lt: 5 }, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new Error("INVALID_MFA_CHALLENGE");
    if (recoveryId) {
      const used = await tx.administratorRecoveryCode.updateMany({ where: { id: recoveryId, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count !== 1) throw new Error("INVALID_MFA_CODE");
    }
  });
}

export async function completeLoginChallenge(code: string, request: Request) {
  const { challenge, recovery } = await validateEmailOrRecoveryCode(code, "LOGIN");
  await consumeValidatedChallenge(challenge.id, recovery?.id);
  const authenticationMethod = recovery ? "PASSWORD_RECOVERY" as const : "PASSWORD_EMAIL_OTP" as const;
  const session = await createSession(challenge.userId, request, { mfaVerified: true, recent: true, authenticationMethod });
  return { userId: challenge.userId, sessionId: session.id, recoveryUsed: Boolean(recovery), authenticationMethod };
}

export async function resendPendingLoginChallenge() {
  const { challenge } = await pendingEmailChallenge("LOGIN");
  const result = await createEmailChallenge(challenge.userId, "LOGIN");
  return { userId: challenge.userId, ...result };
}

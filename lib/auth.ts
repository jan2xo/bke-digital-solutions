import "server-only";
import argon2 from "argon2";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hashToken, randomToken } from "@/lib/security/crypto";

const COOKIE = env.NODE_ENV === "production" ? "__Host-bke_session" : "bke_session";
const SESSION_DAYS = 14;
const SESSION_IDLE_MINUTES = 60;

export async function hashPassword(password: string) { return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }); }
export async function verifyPassword(hash: string, password: string) { try { return await argon2.verify(hash, password); } catch { return false; } }

export async function createSession(userId: string, request?: Request, options?: { mfaVerified?: boolean; recent?: boolean }) {
  const token = randomToken(); const now = new Date(); const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  await db.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt, absoluteExpiresAt: expiresAt, lastSeenAt: now, mfaVerifiedAt: options?.mfaVerified ? now : null, recentAuthenticatedAt: options?.recent ? now : null, userAgent: request?.headers.get("user-agent")?.slice(0, 500) } });
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
}

export async function destroySession() { const jar = await cookies(); const token = jar.get(COOKIE)?.value; if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } }); jar.delete(COOKIE); }

export async function currentSession() {
  const token = (await cookies()).get(COOKIE)?.value; if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: { administratorMfa: true } } } });
  const now = new Date();
  if (!session || session.expiresAt <= now || session.absoluteExpiresAt <= now || session.lastSeenAt < new Date(now.getTime() - SESSION_IDLE_MINUTES * 60_000) || session.user.suspendedAt) { if (session) await db.session.delete({ where: { id: session.id } }).catch(() => undefined); return null; }
  if (session.lastSeenAt < new Date(now.getTime() - 5 * 60_000)) await db.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  return session;
}

export async function currentUser() { return (await currentSession())?.user ?? null; }
export async function requireUser() { const user = await currentUser(); if (!user) throw new Error("UNAUTHENTICATED"); return user; }
export async function requireAdmin() { const session = await currentSession(); if (!session) throw new Error("UNAUTHENTICATED"); if (session.user.role !== "ADMIN") throw new Error("FORBIDDEN"); if (!session.user.administratorMfa?.enabledAt) throw new Error("MFA_ENROLLMENT_REQUIRED"); if (!session.mfaVerifiedAt) throw new Error("MFA_REQUIRED"); return session.user; }
export async function requireAdminEnrollmentSession() { const session = await currentSession(); if (!session) throw new Error("UNAUTHENTICATED"); if (session.user.role !== "ADMIN") throw new Error("FORBIDDEN"); return session; }
export async function requireRecentSession(maxAgeMinutes = 15) { const session = await currentSession(); if (!session) throw new Error("UNAUTHENTICATED"); if (!session.recentAuthenticatedAt || session.recentAuthenticatedAt < new Date(Date.now() - maxAgeMinutes * 60_000)) throw new Error("RECENT_AUTH_REQUIRED"); return session; }
export async function requireRecentUser(maxAgeMinutes = 15) { return (await requireRecentSession(maxAgeMinutes)).user; }
export async function requireRecentAdmin(maxAgeMinutes = 15) { const session = await requireRecentSession(maxAgeMinutes); if (session.user.role !== "ADMIN") throw new Error("FORBIDDEN"); if (!session.user.administratorMfa?.enabledAt || !session.mfaVerifiedAt) throw new Error("MFA_REQUIRED"); return session.user; }

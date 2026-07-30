import "server-only";
import argon2 from "argon2";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hashToken, randomToken } from "@/lib/security/crypto";

const COOKIE = env.NODE_ENV === "production" ? "__Host-bke_session" : "bke_session";
const SESSION_DAYS = 14;

export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}
export async function verifyPassword(hash: string, password: string) {
  try { return await argon2.verify(hash, password); } catch { return false; }
}
export async function createSession(userId: string, request?: Request) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt, userAgent: request?.headers.get("user-agent")?.slice(0, 500) } });
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
}
export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(COOKIE);
}
export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt <= new Date()) return null;
  return session.user;
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new Error("FORBIDDEN");
  return user;
}

import "server-only";
import { cookies } from "next/headers";
import {
  IDENTITY_SESSION_VALIDATION_CAPABILITY_ID,
  type IdentitySessionContext,
  type IdentitySessionValidationCapability,
} from "@bke/identity/contracts/session-validation.contract";
import type { IdentityPrincipal } from "@bke/identity/contracts/identity.contract";
import { getV2WebApplication } from "../runtime";

const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

function cookieName() {
  return process.env.NODE_ENV === "production" ? "__Host-bke_session" : "bke_session";
}

export async function currentIdentitySessionToken(): Promise<string | null> {
  return (await cookies()).get(cookieName())?.value ?? null;
}

export async function writeIdentitySessionCookie(
  token: string,
  expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS),
): Promise<void> {
  (await cookies()).set(cookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearIdentitySessionCookie(): Promise<void> {
  (await cookies()).delete(cookieName());
}

export async function currentIdentitySession(): Promise<IdentitySessionContext | null> {
  const token = await currentIdentitySessionToken();
  if (!token) return null;
  const application = await getV2WebApplication();
  const sessionValidation = application.get<IdentitySessionValidationCapability>(
    IDENTITY_SESSION_VALIDATION_CAPABILITY_ID,
  );
  const result = await sessionValidation.validate(token);
  if (result.status === "VALID") return result.context;
  if (result.status === "INVALID") return null;
  throw new Error(result.code);
}

export async function requireIdentityUser(): Promise<IdentityPrincipal> {
  const session = await currentIdentitySession();
  if (!session) throw new Error("UNAUTHENTICATED");
  return session.principal;
}

export async function requireIdentityAdmin(): Promise<IdentitySessionContext> {
  const session = await currentIdentitySession();
  if (!session) throw new Error("UNAUTHENTICATED");
  if (session.principal.role !== "ADMIN") throw new Error("FORBIDDEN");
  if (!session.administratorMfaEnabled) throw new Error("MFA_ENROLLMENT_REQUIRED");
  if (!session.session.mfaVerifiedAt) throw new Error("MFA_REQUIRED");
  return session;
}

export async function requireRecentIdentitySession(maxAgeMinutes = 15): Promise<IdentitySessionContext> {
  const session = await currentIdentitySession();
  if (!session) throw new Error("UNAUTHENTICATED");
  const recent = session.session.recentAuthenticatedAt;
  if (!recent || recent < new Date(Date.now() - maxAgeMinutes * 60_000)) throw new Error("RECENT_AUTH_REQUIRED");
  return session;
}

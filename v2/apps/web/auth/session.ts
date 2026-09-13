import "server-only";
import { cookies } from "next/headers";
import {
  IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID,
  type IdentitySessionAuthenticationMethod,
  type IdentitySessionIssuanceCapability,
} from "@bke/identity/contracts/session.contract";
import {
  IDENTITY_SESSION_TERMINATION_CAPABILITY_ID,
  type IdentitySessionTerminationCapability,
} from "@bke/identity/contracts/session-termination.contract";
import {
  IDENTITY_SESSION_VALIDATION_CAPABILITY_ID,
  type IdentitySessionContext,
  type IdentitySessionValidationCapability,
} from "@bke/identity/contracts/session-validation.contract";
import type { IdentityPrincipal } from "@bke/identity/contracts/identity.contract";
import { createArgon2PasswordHasher } from "@bke/identity/providers/argon2-password-hasher";
import { createArgon2PasswordVerifier } from "@bke/identity/providers/argon2-password-verifier";
import { safeNetworkHint, summarizeUserAgent } from "@/v2/platform/host/security/session-display";
import { clientIp } from "../http/request";
import { getV2WebApplication } from "../runtime";

const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
const passwordHasher = createArgon2PasswordHasher();
const passwordVerifier = createArgon2PasswordVerifier();

class IdentitySessionOperationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

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

export async function terminateCurrentIdentitySession(): Promise<void> {
  const token = await currentIdentitySessionToken();
  if (token) {
    const application = await getV2WebApplication();
    const sessionTermination = application.get<IdentitySessionTerminationCapability>(
      IDENTITY_SESSION_TERMINATION_CAPABILITY_ID,
    );
    const result = await sessionTermination.terminate(token);
    if (result.status === "FAILED") throw new IdentitySessionOperationError(result.code, 503);
  }
  await clearIdentitySessionCookie();
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

export async function issueIdentitySession(
  userId: string,
  request?: Request,
  authenticationMethod: IdentitySessionAuthenticationMethod = "PASSWORD",
) {
  const application = await getV2WebApplication();
  const issuance = application.get<IdentitySessionIssuanceCapability>(
    IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID,
  );
  const result = await issuance.issue({
    userId,
    authenticationMethod,
    userAgentSummary: summarizeUserAgent(request?.headers.get("user-agent")),
    networkHint: safeNetworkHint(request ? clientIp(request) : "unknown"),
  });
  if (result.status === "REJECTED") throw new Error(result.code);
  if (result.status === "FAILED") throw new IdentitySessionOperationError(result.code, 503);
  await writeIdentitySessionCookie(result.token, result.session.expiresAt);
  return result.session;
}

export async function hashIdentityPassword(password: string) {
  return passwordHasher.hash(password);
}

export async function verifyIdentityPassword(hash: string, password: string) {
  return passwordVerifier.verify(hash, password);
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

// Compatibility surface for the production host while callers converge on the
// native Identity context. These functions contain no authentication policy of
// their own; they delegate to the released @bke/identity capabilities above.
export const hashPassword = hashIdentityPassword;
export const verifyPassword = verifyIdentityPassword;
export const clearSessionCookie = clearIdentitySessionCookie;
export const destroySession = terminateCurrentIdentitySession;

export async function createSession(
  userId: string,
  request?: Request,
  options?: {
    mfaVerified?: boolean;
    recent?: boolean;
    authenticationMethod?: IdentitySessionAuthenticationMethod;
  },
) {
  const authenticationMethod = options?.authenticationMethod
    ?? (options?.mfaVerified ? "PASSWORD_EMAIL_OTP" : "PASSWORD");
  return issueIdentitySession(userId, request, authenticationMethod);
}

export async function currentUser() {
  return (await currentIdentitySession())?.principal ?? null;
}

export const requireUser = requireIdentityUser;

export async function requireAdmin() {
  return (await requireIdentityAdmin()).principal;
}

function legacySessionView(context: IdentitySessionContext) {
  return Object.freeze({ ...context.session, user: context.principal });
}

export async function requireRecentSession(maxAgeMinutes = 15) {
  return legacySessionView(await requireRecentIdentitySession(maxAgeMinutes));
}

export async function requireRecentUser(maxAgeMinutes = 15) {
  return (await requireRecentIdentitySession(maxAgeMinutes)).principal;
}

export async function requireRecentAdmin(maxAgeMinutes = 15) {
  const context = await requireRecentIdentitySession(maxAgeMinutes);
  if (context.principal.role !== "ADMIN") throw new Error("FORBIDDEN");
  if (!context.administratorMfaEnabled || !context.session.mfaVerifiedAt) throw new Error("MFA_REQUIRED");
  return context.principal;
}

export async function requireRecentAdminSession(maxAgeMinutes = 15) {
  const context = await requireRecentIdentitySession(maxAgeMinutes);
  if (context.principal.role !== "ADMIN") throw new Error("FORBIDDEN");
  if (!context.administratorMfaEnabled || !context.session.mfaVerifiedAt) throw new Error("MFA_REQUIRED");
  return legacySessionView(context);
}

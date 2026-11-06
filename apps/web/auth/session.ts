import "server-only";
import { cookies } from "next/headers";
import {
  IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID,
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
import { safeNetworkHint, summarizeUserAgent } from "@/platform/host/security/session-display";
import { clientIp } from "../http/request";
import { getIdentityWebApplication } from "./runtime";
import { db } from "@/platform/host/db";
import { hasFreshGoogleAuthentication } from "./google-policy";

const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

class IdentitySessionOperationError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
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
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", expires: expiresAt,
  });
}

export async function clearIdentitySessionCookie(): Promise<void> {
  (await cookies()).delete(cookieName());
}

export async function terminateCurrentIdentitySession(): Promise<void> {
  const token = await currentIdentitySessionToken();
  if (token) {
    const application = await getIdentityWebApplication();
    const termination = application.get<IdentitySessionTerminationCapability>(
      IDENTITY_SESSION_TERMINATION_CAPABILITY_ID,
    );
    const result = await termination.terminate(token);
    if (result.status === "FAILED") throw new IdentitySessionOperationError(result.code, 503);
  }
  await clearIdentitySessionCookie();
}

export async function currentIdentitySession(): Promise<IdentitySessionContext | null> {
  const token = await currentIdentitySessionToken();
  if (!token) return null;
  const application = await getIdentityWebApplication();
  const validation = application.get<IdentitySessionValidationCapability>(
    IDENTITY_SESSION_VALIDATION_CAPABILITY_ID,
  );
  const result = await validation.validate(token);
  if (result.status === "INVALID") return null;
  if (result.status === "FAILED") throw new IdentitySessionOperationError(result.code, 503);
  // Consumer policy accepts Google primary sessions only. Historical password
  // and application-MFA methods in the shared package do not gain admission.
  if (result.context.session.authenticationMethod !== "GOOGLE_OIDC") return null;
  const principal = await db.user.findUnique({
    where: { id: result.context.principal.id },
    select: { lifecycleState: true, suspendedAt: true, googleIdentity: { select: { subject: true } } },
  });
  if (!principal || principal.lifecycleState !== "ACTIVE" || principal.suspendedAt ||
      !principal.googleIdentity) return null;
  return result.context;
}

/** Persist only Google's authenticated-at fact, never callback time or token iat. */
export async function recordGoogleSessionFreshness(input: {
  sessionId: string;
  userId: string;
  subject: string;
  authenticatedAt: Date | null;
}): Promise<void> {
  if (!hasFreshGoogleAuthentication(input.authenticatedAt)) throw new Error("RECENT_AUTH_REQUIRED");
  const now = new Date();
  const changed = await db.session.updateMany({
    where: {
      id: input.sessionId, userId: input.userId, authenticationMethod: "GOOGLE_OIDC",
      revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now },
      user: {
        lifecycleState: "ACTIVE", suspendedAt: null,
        googleIdentity: { subject: input.subject },
      },
    },
    data: {
      recentAuthenticatedAt: input.authenticatedAt,
      assuranceLevel: "RECENTLY_AUTHENTICATED",
      mfaVerifiedAt: null,
    },
  });
  if (changed.count !== 1) throw new Error("UNAUTHENTICATED");
}

/** This entrypoint is called only with a subject from the validated OIDC callback. */
export async function issueGoogleIdentitySession(input: {
  userId: string;
  subject: string;
  authenticatedAt: Date | null;
  request: Request;
}) {
  const principal = await db.user.findUnique({
    where: { id: input.userId },
    select: { lifecycleState: true, suspendedAt: true, googleIdentity: { select: { subject: true } } },
  });
  if (!principal || principal.lifecycleState !== "ACTIVE" || principal.suspendedAt ||
      principal.googleIdentity?.subject !== input.subject) throw new Error("UNAUTHENTICATED");
  const application = await getIdentityWebApplication();
  const issuance = application.get<IdentitySessionIssuanceCapability>(
    IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID,
  );
  const result = await issuance.issue({
    userId: input.userId, authenticationMethod: "GOOGLE_OIDC",
    userAgentSummary: summarizeUserAgent(input.request.headers.get("user-agent")),
    networkHint: safeNetworkHint(clientIp(input.request)),
  });
  if (result.status === "REJECTED") throw new Error(result.code);
  if (result.status === "FAILED") throw new IdentitySessionOperationError(result.code, 503);
  if (hasFreshGoogleAuthentication(input.authenticatedAt)) {
    await recordGoogleSessionFreshness({
      sessionId: result.session.id, userId: input.userId,
      subject: input.subject, authenticatedAt: input.authenticatedAt,
    });
  }
  await writeIdentitySessionCookie(result.token, result.session.expiresAt);
  return result.session;
}

export async function requireIdentityUser(): Promise<IdentityPrincipal> {
  const context = await currentIdentitySession();
  if (!context) throw new Error("UNAUTHENTICATED");
  return context.principal;
}

export async function requireIdentityAdmin(): Promise<IdentitySessionContext> {
  const context = await currentIdentitySession();
  if (!context) throw new Error("UNAUTHENTICATED");
  if (context.principal.role !== "ADMIN") throw new Error("FORBIDDEN");
  return context;
}

export async function requireRecentIdentitySession(maxAgeMinutes = 15): Promise<IdentitySessionContext> {
  const context = await currentIdentitySession();
  if (!context) throw new Error("UNAUTHENTICATED");
  if (context.session.assuranceLevel !== "RECENTLY_AUTHENTICATED" ||
      context.session.mfaVerifiedAt !== null ||
      !hasFreshGoogleAuthentication(context.session.recentAuthenticatedAt, maxAgeMinutes)) {
    throw new Error("RECENT_AUTH_REQUIRED");
  }
  return context;
}

export const clearSessionCookie = clearIdentitySessionCookie;
export async function currentUser() { return (await currentIdentitySession())?.principal ?? null; }
export const requireUser = requireIdentityUser;
export async function requireAdmin() { return (await requireIdentityAdmin()).principal; }
export async function requireRecentUser(maxAgeMinutes = 15) {
  return (await requireRecentIdentitySession(maxAgeMinutes)).principal;
}
/**
 * Compatibility entrypoints for existing admin API routes.
 * Owner-retired Google auth_time step-up must not gate administration.
 * An active Google OIDC session, immutable binding and explicit ADMIN role
 * remain mandatory. Customer/Agent-sensitive freshness stays independent.
 */
export async function requireRecentAdmin(_maxAgeMinutes = 15) {
  return (await requireIdentityAdmin()).principal;
}
export async function requireRecentAdminSession(_maxAgeMinutes = 15) {
  const context = await requireIdentityAdmin();
  return Object.freeze({ ...context.session, user: context.principal });
}

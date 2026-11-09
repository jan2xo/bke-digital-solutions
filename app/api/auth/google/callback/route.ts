import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  IDENTITY_GOOGLE_AUTHENTICATION_CAPABILITY_ID,
  type IdentityGoogleAuthenticationCapability,
} from "@bke/identity/contracts/google-authentication.contract";
import { getIdentityWebApplication } from "@/apps/web/auth/runtime";
import {
  currentIdentitySession, issueGoogleIdentitySession, recordGoogleSessionFreshness,
} from "@/apps/web/auth/session";
import { completeGoogleAuthorization, GOOGLE_LOGIN_CONTEXT_COOKIE } from "@/apps/web/auth/google-oidc";
import { authoritativeGoogleContact } from "@/apps/web/auth/google-policy";
import { pendingReacceptance } from "@/apps/web/legal/service";
import { registerGoogleCustomer } from "@/apps/web/auth/google-registration";
import { createPendingGoogleEnrollment, GOOGLE_ENROLLMENT_COOKIE, GOOGLE_ENROLLMENT_TTL_SECONDS } from "@/apps/web/auth/google-enrollment";
import { securityEvent } from "@/apps/web/security/events";
import { getWebHostEnvironment } from "@/apps/web/config/environment";
import { safeLocalRedirect } from "@/apps/web/security/redirect";
import { db } from "@/platform/host/db";

function finishRedirect(path: string) {
  const response = NextResponse.redirect(new URL(path, getWebHostEnvironment().appUrl));
  response.cookies.delete(GOOGLE_LOGIN_CONTEXT_COOKIE);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const encryptedContext = cookieStore.get(GOOGLE_LOGIN_CONTEXT_COOKIE)?.value;
  if (!encryptedContext) return finishRedirect("/login?error=GOOGLE_SIGN_IN_FAILED");
  let reauthentication = false;
  try {
    const verified = await completeGoogleAuthorization(request.url, encryptedContext);
    reauthentication = verified.context.flow === "reauthenticate";
    const application = await getIdentityWebApplication();
    const authentication = application.get<IdentityGoogleAuthenticationCapability>(
      IDENTITY_GOOGLE_AUTHENTICATION_CAPABILITY_ID,
    );
    let authenticated = await authentication.authenticate({ subject: verified.identity.subject });

    if (reauthentication) {
      const current = await currentIdentitySession();
      if (!current || current.session.id !== verified.context.sessionId ||
          current.principal.id !== verified.context.userId ||
          verified.identity.subject !== verified.context.subject ||
          authenticated.status !== "PRIMARY_AUTHENTICATED" ||
          authenticated.principal.id !== current.principal.id) {
        throw new Error("UNAUTHENTICATED");
      }
      await recordGoogleSessionFreshness({
        sessionId: current.session.id, userId: current.principal.id,
        subject: verified.identity.subject, authenticatedAt: verified.identity.authenticatedAt,
      });
      await securityEvent("RECENT_AUTH_SUCCEEDED", request, current.principal.id,
        { method: "GOOGLE_AUTH_TIME" },
        { sessionId: current.session.id, authenticationMethod: "GOOGLE_OIDC" });
      return finishRedirect(safeLocalRedirect(verified.context.returnTo));
    }

    if (!authoritativeGoogleContact(verified.identity)) {
      return finishRedirect("/login?error=CONTACT_EMAIL_NOT_AUTHORITATIVE");
    }
    if (authenticated.status === "INVALID_CREDENTIALS") {
      if (verified.context.flow === "unified") {
        const pending = await createPendingGoogleEnrollment({
          ...verified.identity,
          returnTo: verified.context.returnTo,
        });
        const response = finishRedirect("/auth/consent");
        response.cookies.set(GOOGLE_ENROLLMENT_COOKIE, pending, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: GOOGLE_ENROLLMENT_TTL_SECONDS,
        });
        return response;
      }
      if (verified.context.flow !== "register") return finishRedirect("/login?error=GOOGLE_SIGN_IN_FAILED");
      await registerGoogleCustomer({
        subject: verified.identity.subject, email: verified.identity.email,
        emailVerified: verified.identity.emailVerified, hostedDomain: verified.identity.hostedDomain,
        name: verified.identity.name, legalVersionIds: verified.context.legalVersionIds, request,
      });
      authenticated = await authentication.authenticate({ subject: verified.identity.subject });
    }
    if (authenticated.status !== "PRIMARY_AUTHENTICATED") {
      throw new Error(authenticated.status === "FAILED" ? authenticated.code : "UNAUTHENTICATED");
    }
    const userId = authenticated.principal.id;
    // The subject selected this principal. A contact change never selects or
    // links a different account and cannot grant a role; uniqueness conflicts fail closed.
    const priorEmail = authenticated.principal.email;
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId, lifecycleState: "ACTIVE", suspendedAt: null,
          googleIdentity: { subject: verified.identity.subject } },
        data: { email: verified.identity.email!, emailVerified: new Date() },
      });
      if (priorEmail !== verified.identity.email) {
        await tx.auditLog.create({ data: {
          actorId: userId, action: "GOOGLE_CONTACT_UPDATED", targetType: "User", targetId: userId,
          metadata: { authenticationProvider: "GOOGLE_OIDC" },
        } });
      }
    });
    const session = await issueGoogleIdentitySession({
      userId, subject: verified.identity.subject,
      authenticatedAt: verified.identity.authenticatedAt, request,
    });
    if (authenticated.principal.role === "ADMIN") {
      for (const event of ["ADMIN_LOGIN_SUCCEEDED", "ADMIN_SESSION_CREATED"] as const) {
        await securityEvent(event, request, userId, undefined,
          { sessionId: session.id, authenticationMethod: "GOOGLE_OIDC" });
      }
    }
    const returnTo = safeLocalRedirect(verified.context.returnTo);
    const destination = (await pendingReacceptance(userId)).length > 0
      ? `/legal/accept?returnTo=${encodeURIComponent(returnTo)}`
      : returnTo;
    return finishRedirect(destination);
  } catch {
    // No token, authorization code, raw provider response or contact address in errors.
    return finishRedirect(reauthentication
      ? "/security/recent?error=GOOGLE_FRESH_AUTH_REQUIRED"
      : "/login?error=GOOGLE_SIGN_IN_FAILED");
  }
}

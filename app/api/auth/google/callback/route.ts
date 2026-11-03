import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  IDENTITY_GOOGLE_AUTHENTICATION_CAPABILITY_ID,
  type IdentityGoogleAuthenticationCapability,
} from "@bke/identity/contracts/google-authentication.contract";
import { getV2WebApplication } from "@/apps/web/runtime";
import { createSession } from "@/apps/web/auth/session";
import {
  completeGoogleAuthorization,
  GOOGLE_LOGIN_CONTEXT_COOKIE,
} from "@/apps/web/auth/google-oidc";
import { issueIdentityLoginMfaChallenge } from "@/apps/web/auth/mfa-challenge";
import { pendingReacceptance } from "@/apps/web/legal/service";
import { registerGoogleCustomer } from "@/apps/web/auth/google-registration";
import { sendVerificationEmail } from "@/apps/web/email";
import { apiError } from "@/apps/web/http/api-error";
import { securityEvent } from "@/apps/web/security/events";
import { getWebHostEnvironment } from "@/apps/web/config/environment";
import { safeLocalRedirect } from "@/apps/web/security/redirect";

function safeErrorRedirect(code: string) {
  const destination = new URL("/login", getWebHostEnvironment().appUrl);
  destination.searchParams.set("error", code);
  return NextResponse.redirect(destination);
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const encryptedContext = cookieStore.get(GOOGLE_LOGIN_CONTEXT_COOKIE)?.value;
  const cleared = () => {
    const response = safeErrorRedirect("GOOGLE_SIGN_IN_FAILED");
    response.cookies.delete(GOOGLE_LOGIN_CONTEXT_COOKIE);
    return response;
  };
  if (!encryptedContext) return cleared();

  let registeredNewUser = false;
  try {
    const verified = await completeGoogleAuthorization(request.url, encryptedContext);
    const application = await getV2WebApplication();
    const authentication = application.get<IdentityGoogleAuthenticationCapability>(
      IDENTITY_GOOGLE_AUTHENTICATION_CAPABILITY_ID,
    );
    let authenticated = await authentication.authenticate({
      subject: verified.identity.subject,
    });

    let userId: string;
    if (authenticated.status === "PRIMARY_AUTHENTICATED") {
      userId = authenticated.principal.id;
    } else if (authenticated.status === "INVALID_CREDENTIALS") {
      if (verified.context.flow !== "register") return cleared();
      const created = await registerGoogleCustomer({
        subject: verified.identity.subject,
        email: verified.identity.email,
        emailVerified: verified.identity.emailVerified,
        name: verified.identity.name,
        legalVersionIds: verified.context.legalVersionIds,
        request,
      });
      userId = created.user.id;
      registeredNewUser = true;
      try {
        await sendVerificationEmail(created.user.email, created.verificationToken);
      } catch {
        // Contact verification can be resent through the canonical BKE email flow.
      }
      authenticated = await authentication.authenticate({
        subject: verified.identity.subject,
      });
      if (authenticated.status !== "PRIMARY_AUTHENTICATED") return cleared();
    } else {
      throw new Error(authenticated.code);
    }

    const method = authenticated.status === "PRIMARY_AUTHENTICATED"
      ? authenticated.route
      : "SESSION";
    if (method === "MFA_CHALLENGE") {
      const challenge = await issueIdentityLoginMfaChallenge(userId, "GOOGLE_OIDC");
      const response = NextResponse.redirect(new URL("/login/mfa", getWebHostEnvironment().appUrl));
      response.cookies.set(GOOGLE_LOGIN_CONTEXT_COOKIE, "", { maxAge: 0, path: "/" });
      const { IDENTITY_MFA_CHALLENGE_COOKIE, IDENTITY_MFA_CHALLENGE_COOKIE_OPTIONS } =
        await import("@/apps/web/auth/mfa-challenge");
      response.cookies.set(
        IDENTITY_MFA_CHALLENGE_COOKIE,
        challenge.token,
        IDENTITY_MFA_CHALLENGE_COOKIE_OPTIONS,
      );
      return response;
    }

    const session = await createSession(userId, request, {
      authenticationMethod: "GOOGLE_OIDC",
    });
    if (authenticated.status === "PRIMARY_AUTHENTICATED" && authenticated.principal.role === "ADMIN") {
      await securityEvent("ADMIN_LOGIN_SUCCEEDED", request, userId, undefined, {
        sessionId: session.id,
        authenticationMethod: "GOOGLE_OIDC",
      });
      await securityEvent("ADMIN_SESSION_CREATED", request, userId, undefined, {
        sessionId: session.id,
        authenticationMethod: "GOOGLE_OIDC",
      });
    }

    const destination =
      registeredNewUser
        ? "/verify-email"
        : method === "MFA_ENROLLMENT"
        ? "/security/mfa"
        : (await pendingReacceptance(userId)).length > 0
          ? "/legal/accept?returnTo=%2Fdashboard"
          : safeLocalRedirect(verified.context.returnTo);
    const response = NextResponse.redirect(new URL(destination, getWebHostEnvironment().appUrl));
    response.cookies.delete(GOOGLE_LOGIN_CONTEXT_COOKIE);
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_EXISTS") {
      return safeErrorRedirect("ACCOUNT_EXISTS");
    }
    return cleared();
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  IDENTITY_RECENT_AUTH_COMPLETION_CAPABILITY_ID,
  type IdentityRecentAuthCompletionCapability,
} from "@bke/identity/contracts/recent-auth-completion.contract";
import {
  currentIdentitySession,
  currentIdentitySessionToken,
} from "@/v2/apps/web/auth/session";
import {
  currentIdentityMfaChallengeToken,
  IDENTITY_MFA_CHALLENGE_COOKIE,
  IdentityCapabilityError,
} from "@/v2/apps/web/auth/mfa-challenge";
import { getV2WebApplication } from "@/v2/apps/web/runtime";
import { apiError } from "@/v2/apps/web/http/api-error";
import { securityEvent } from "@/v2/apps/web/security/events";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";

const schema = z.object({
  password: z.string().min(1).max(128),
  code: z.string().min(6).max(32).optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await currentIdentitySession();
    if (!session) throw new Error("UNAUTHENTICATED");
    if (!(await rateLimit(`recent:${session.principal.id}:${clientIp(request)}`, 5, 900)).allowed) {
      throw new Error("RATE_LIMITED");
    }

    const { password, code } = schema.parse(await request.json());
    const sessionToken = await currentIdentitySessionToken();
    if (!sessionToken) throw new Error("UNAUTHENTICATED");

    let challengeToken: string | undefined;
    if (session.principal.role === "ADMIN") {
      if (!code) throw new Error("INVALID_CREDENTIALS");
      challengeToken = (await currentIdentityMfaChallengeToken()) ?? undefined;
      if (!challengeToken) throw new Error("INVALID_MFA_CHALLENGE");
    }

    const application = await getV2WebApplication();
    const completion = application.get<IdentityRecentAuthCompletionCapability>(
      IDENTITY_RECENT_AUTH_COMPLETION_CAPABILITY_ID,
    );
    const result = await completion.complete({
      sessionToken,
      password,
      challengeToken,
      code,
    });

    if (result.status === "INVALID") {
      if (result.code === "INVALID_CREDENTIALS") {
        await securityEvent("RECENT_AUTH_FAILED", request, session.principal.id);
        throw new Error("INVALID_CREDENTIALS");
      }
      if (result.code === "INVALID_SESSION") throw new Error("UNAUTHENTICATED");
      if (result.code === "MFA_REQUIRED") throw new Error("INVALID_CREDENTIALS");
      if (result.code === "INVALID_CHALLENGE") throw new Error("INVALID_MFA_CHALLENGE");
      throw new Error("INVALID_MFA_CODE");
    }
    if (result.status === "FAILED") throw new IdentityCapabilityError(result.code);

    if (result.verificationMethod === "PASSWORD_RECOVERY") {
      await securityEvent(
        "MFA_RECOVERY_USED",
        request,
        session.principal.id,
        undefined,
        {
          sessionId: result.session.id,
          authenticationMethod: result.verificationMethod,
        },
      );
    }
    await securityEvent(
      "RECENT_AUTH_SUCCEEDED",
      request,
      session.principal.id,
      undefined,
      {
        sessionId: result.session.id,
        authenticationMethod: result.verificationMethod,
      },
    );

    const response = NextResponse.json({ ok: true });
    if (session.principal.role === "ADMIN") {
      response.cookies.delete(IDENTITY_MFA_CHALLENGE_COOKIE);
    }
    return response;
  } catch (error) {
    return apiError(error);
  }
}

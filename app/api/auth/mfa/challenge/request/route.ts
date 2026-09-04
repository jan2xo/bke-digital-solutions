import { NextResponse } from "next/server";
import { z } from "zod";
import {
  IDENTITY_RECENT_AUTH_CHALLENGE_ISSUANCE_CAPABILITY_ID,
  type IdentityRecentAuthChallengeIssuanceCapability,
} from "@bke/identity/contracts/recent-auth-challenge.contract";
import { resendPendingLoginChallenge } from "@/lib/admin-mfa";
import { currentIdentitySession } from "@/v2/apps/web/auth/session";
import {
  deliverIdentityMfaChallenge,
  IDENTITY_MFA_CHALLENGE_COOKIE,
  IDENTITY_MFA_CHALLENGE_COOKIE_OPTIONS,
  IdentityCapabilityError,
} from "@/v2/apps/web/auth/mfa-challenge";
import { getV2WebApplication } from "@/v2/apps/web/runtime";
import { apiError } from "@/v2/apps/web/http/api-error";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { purpose } = z
      .object({ purpose: z.enum(["LOGIN", "RECENT_AUTH"]) })
      .parse(await request.json());

    let challenge: { token: string; delivered: boolean; reference: string };
    if (purpose === "LOGIN") {
      if (!(await rateLimit(`admin-email-otp-resend:${clientIp(request)}`, 3, 600)).allowed) {
        throw new Error("RATE_LIMITED");
      }
      challenge = await resendPendingLoginChallenge();
    } else {
      const session = await currentIdentitySession();
      if (
        !session ||
        session.principal.role !== "ADMIN" ||
        !session.session.mfaVerifiedAt
      ) {
        throw new Error("UNAUTHENTICATED");
      }
      if (!(await rateLimit(`admin-email-otp-recent:${session.principal.id}:${clientIp(request)}`, 3, 600)).allowed) {
        throw new Error("RATE_LIMITED");
      }

      const application = await getV2WebApplication();
      const issuance = application.get<IdentityRecentAuthChallengeIssuanceCapability>(
        IDENTITY_RECENT_AUTH_CHALLENGE_ISSUANCE_CAPABILITY_ID,
      );
      const result = await issuance.issue({ userId: session.principal.id });
      if (result.status === "REJECTED") {
        throw new Error(result.code === "PRINCIPAL_NOT_FOUND" ? "UNAUTHENTICATED" : result.code);
      }
      if (result.status === "FAILED") throw new IdentityCapabilityError(result.code);

      challenge = {
        token: result.challenge.challengeToken,
        delivered: await deliverIdentityMfaChallenge({
          userId: session.principal.id,
          purpose: "RECENT_AUTH",
          delivery: result.challenge.delivery,
        }),
        reference: result.challenge.delivery.reference,
      };
    }

    const response = NextResponse.json({
      ok: true,
      emailSent: challenge.delivered,
      mfaReference: challenge.reference,
    });
    response.cookies.set(
      IDENTITY_MFA_CHALLENGE_COOKIE,
      challenge.token,
      IDENTITY_MFA_CHALLENGE_COOKIE_OPTIONS,
    );
    return response;
  } catch (error) {
    return apiError(error);
  }
}

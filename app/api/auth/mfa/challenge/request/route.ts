import { NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_EMAIL_CHALLENGE_COOKIE, ADMIN_EMAIL_CHALLENGE_COOKIE_OPTIONS, createEmailChallenge, resendPendingLoginChallenge } from "@/lib/admin-mfa";
import { currentSession } from "@/lib/auth";
import { apiError } from "@/v2/apps/web/http/api-error";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { purpose } = z.object({ purpose: z.enum(["LOGIN", "RECENT_AUTH"]) }).parse(await request.json());
    let challenge:{token:string;delivered:boolean;reference:string};
    if (purpose === "LOGIN") {
      if (!(await rateLimit(`admin-email-otp-resend:${clientIp(request)}`, 3, 600)).allowed) throw new Error("RATE_LIMITED");
      challenge=await resendPendingLoginChallenge();
    } else {
      const session = await currentSession();
      if (!session || session.user.role !== "ADMIN" || !session.mfaVerifiedAt) throw new Error("UNAUTHENTICATED");
      if (!(await rateLimit(`admin-email-otp-recent:${session.userId}:${clientIp(request)}`, 3, 600)).allowed) throw new Error("RATE_LIMITED");
      challenge=await createEmailChallenge(session.userId, "RECENT_AUTH");
    }
    const response=NextResponse.json({ok:true,emailSent:challenge.delivered,mfaReference:challenge.reference});response.cookies.set(ADMIN_EMAIL_CHALLENGE_COOKIE,challenge.token,ADMIN_EMAIL_CHALLENGE_COOKIE_OPTIONS);return response;
  } catch (error) { return apiError(error); }
}

import {
  IDENTITY_MFA_EMERGENCY_ENROLLMENT_CAPABILITY_ID,
  type IdentityMfaEmergencyEnrollmentCapability,
} from "@bke/identity/contracts/mfa-emergency-enrollment.contract";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  currentIdentitySession,
  currentIdentitySessionToken,
  writeIdentitySessionCookie,
} from "@/v2/apps/web/auth/session";
import { apiError } from "@/v2/apps/web/http/api-error";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { getV2WebApplication } from "@/v2/apps/web/runtime";

const schema = z.object({ token: z.string().min(40).max(256) });

class EmergencyEnrollmentHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

function fail(code: string, status: number): never {
  throw new EmergencyEnrollmentHttpError(code, status);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const [sessionToken, session] = await Promise.all([
      currentIdentitySessionToken(),
      currentIdentitySession(),
    ]);
    if (!sessionToken || !session) fail("UNAUTHENTICATED", 401);

    if (!(await rateLimit(`mfa-emergency-enroll:${session.principal.id}:${clientIp(request)}`, 5, 900)).allowed) {
      fail("RATE_LIMITED", 429);
    }

    const { token } = schema.parse(await request.json());
    const application = await getV2WebApplication();
    const emergencyEnrollment = application.get<IdentityMfaEmergencyEnrollmentCapability>(
      IDENTITY_MFA_EMERGENCY_ENROLLMENT_CAPABILITY_ID,
    );
    const result = await emergencyEnrollment.enroll({
      sessionToken,
      emergencyToken: token,
    });

    if (result.status === "INVALID") {
      if (result.code === "INVALID_SESSION") fail("UNAUTHENTICATED", 401);
      if (result.code === "FORBIDDEN" || result.code === "RECENT_AUTH_REQUIRED") fail(result.code, 403);
      fail(result.code, 400);
    }
    if (result.status === "FAILED") fail(result.code, 503);

    await writeIdentitySessionCookie(result.replacementSessionToken);
    return NextResponse.json({ ok: true, recoveryCodes: result.recoveryCodes });
  } catch (error) {
    return apiError(error);
  }
}

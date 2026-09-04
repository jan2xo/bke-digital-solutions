import { NextResponse } from "next/server";
import {
  IDENTITY_MFA_DISABLE_CAPABILITY_ID,
  type IdentityMfaDisableCapability,
} from "@bke/identity/contracts/mfa-disable.contract";
import { audit } from "@/lib/audit";
import { createSession } from "@/lib/auth";
import { requireRecentIdentitySession } from "@/v2/apps/web/auth/session";
import { IdentityCapabilityError } from "@/v2/apps/web/auth/mfa-challenge";
import { getV2WebApplication } from "@/v2/apps/web/runtime";
import { apiError } from "@/v2/apps/web/http/api-error";
import { securityEvent } from "@/lib/security/events";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireRecentIdentitySession();
    if (
      session.principal.role !== "ADMIN" ||
      !session.session.mfaVerifiedAt ||
      !session.administratorMfaEnabled
    ) {
      throw new Error("FORBIDDEN");
    }
    if (!(await rateLimit(`mfa-disable:${session.principal.id}:${clientIp(request)}`, 3, 3600)).allowed) {
      throw new Error("RATE_LIMITED");
    }

    const application = await getV2WebApplication();
    const disable = application.get<IdentityMfaDisableCapability>(
      IDENTITY_MFA_DISABLE_CAPABILITY_ID,
    );
    const result = await disable.disable({ userId: session.principal.id });
    if (result.status === "INVALID") {
      if (result.code === "NOT_FOUND") throw new Error("UNAUTHENTICATED");
      throw new Error(result.code);
    }
    if (result.status === "FAILED") throw new IdentityCapabilityError(result.code);

    await createSession(result.userId, request, {
      recent: true,
      authenticationMethod: "MFA_ENROLLMENT",
    });
    await securityEvent("MFA_DISABLED", request, result.userId);
    await audit({
      actorId: result.userId,
      action: "MFA_DISABLED",
      targetType: "User",
      targetId: result.userId,
    });
    return NextResponse.json({ enrollmentRequired: result.enrollmentRequired });
  } catch (error) {
    return apiError(error);
  }
}

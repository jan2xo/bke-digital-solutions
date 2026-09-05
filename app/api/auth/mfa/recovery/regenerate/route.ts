import { NextResponse } from "next/server";
import {
  IDENTITY_MFA_RECOVERY_REGENERATION_CAPABILITY_ID,
  type IdentityMfaRecoveryRegenerationCapability,
} from "@bke/identity/contracts/mfa-recovery-regeneration.contract";
import { audit } from "@/v2/apps/web/audit";
import { createSession } from "@/lib/auth";
import {
  currentIdentitySessionToken,
  requireRecentIdentitySession,
} from "@/v2/apps/web/auth/session";
import { IdentityCapabilityError } from "@/v2/apps/web/auth/mfa-challenge";
import { getV2WebApplication } from "@/v2/apps/web/runtime";
import { apiError } from "@/v2/apps/web/http/api-error";
import { securityEvent } from "@/v2/apps/web/security/events";
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
    if (!(await rateLimit(`mfa-recovery-regenerate:${session.principal.id}:${clientIp(request)}`, 3, 3600)).allowed) {
      throw new Error("RATE_LIMITED");
    }

    const sessionToken = await currentIdentitySessionToken();
    if (!sessionToken) throw new Error("UNAUTHENTICATED");
    const application = await getV2WebApplication();
    const regeneration = application.get<IdentityMfaRecoveryRegenerationCapability>(
      IDENTITY_MFA_RECOVERY_REGENERATION_CAPABILITY_ID,
    );
    const result = await regeneration.regenerate({ sessionToken });
    if (result.status === "INVALID") {
      if (result.code === "INVALID_SESSION") throw new Error("UNAUTHENTICATED");
      throw new Error(result.code);
    }
    if (result.status === "FAILED") throw new IdentityCapabilityError(result.code);

    await createSession(result.userId, request, {
      mfaVerified: true,
      recent: true,
      authenticationMethod: result.replacementAuthenticationMethod,
    });
    await securityEvent("MFA_RECOVERY_REGENERATED", request, result.userId);
    await audit({
      actorId: result.userId,
      action: "MFA_RECOVERY_REGENERATED",
      targetType: "User",
      targetId: result.userId,
    });
    return NextResponse.json({ recoveryCodes: result.recoveryCodes });
  } catch (error) {
    return apiError(error);
  }
}

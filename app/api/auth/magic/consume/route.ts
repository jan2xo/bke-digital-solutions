import { NextResponse } from "next/server";
import {
  IDENTITY_MAGIC_LOGIN_CONSUME_CAPABILITY_ID,
  type IdentityMagicLoginConsumeCapability,
} from "@bke/identity/contracts/magic-login-consume.contract";
import {
  writeIdentitySessionCookie,
} from "@/apps/web/auth/session";
import { clientIp } from "@/apps/web/http/request";
import { pendingReacceptance } from "@/apps/web/legal/service";
import { getV2WebApplication } from "@/apps/web/runtime";
import { securityEvent } from "@/apps/web/security/events";
import { getWebHostEnvironment } from "@/apps/web/config/environment";
import {
  safeNetworkHint,
  summarizeUserAgent,
} from "@/platform/host/security/session-display";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 400 });
  }

  const application = await getV2WebApplication();
  const magicLogin = application.get<IdentityMagicLoginConsumeCapability>(
    IDENTITY_MAGIC_LOGIN_CONSUME_CAPABILITY_ID,
  );
  const result = await magicLogin.consume({
    token,
    userAgentSummary: summarizeUserAgent(request.headers.get("user-agent")),
    networkHint: safeNetworkHint(clientIp(request)),
  });

  const appUrl = getWebHostEnvironment().appUrl;
  if (result.status === "REJECTED") {
    if (result.code === "ADMIN_PASSWORD_REQUIRED" && result.userId) {
      await securityEvent("ADMIN_MAGIC_LOGIN_BLOCKED", request, result.userId);
      return NextResponse.redirect(
        new URL("/login?error=ADMIN_PASSWORD_REQUIRED", appUrl),
      );
    }
    if (result.code === "MFA_PASSWORD_REQUIRED") {
      return NextResponse.redirect(
        new URL("/login?error=MFA_PASSWORD_REQUIRED", appUrl),
      );
    }
    if (result.code === "ACCOUNT_NOT_ACTIVE") {
      return NextResponse.redirect(
        new URL("/login?error=ACCOUNT_NOT_ACTIVE", appUrl),
      );
    }
    return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 400 });
  }
  if (result.status === "FAILED") {
    throw new Error(result.code);
  }

  await writeIdentitySessionCookie(result.token, result.session.expiresAt);
  const destination =
    (await pendingReacceptance(result.userId)).length > 0
      ? "/legal/accept"
      : "/dashboard";
  return NextResponse.redirect(new URL(destination, appUrl));
}

import "server-only";

import {
  IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID,
  type IdentityLoginMfaAuthenticationMethod,
  type IdentityLoginMfaVerificationCapability,
} from "@bke/identity/contracts/login-mfa-verification.contract";
import type { IdentityPrincipal } from "@bke/identity/contracts/identity.contract";
import {
  IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID,
  type IdentitySessionIssuanceCapability,
} from "@bke/identity/contracts/session.contract";
import {
  issueNativeBkeAgentHandoff,
  resolveNativeBkeAccounts,
} from "@/apps/web/agent-sessions/native-handoff";
import {
  authenticateAgentAccessToken,
  revokeAgentAccountSessionsForUser,
} from "@/apps/web/agent-sessions/device-authorization";
import { verifyPassword } from "@/apps/web/auth/session";
import { getV2WebApplication } from "@/apps/web/runtime";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

export function nativeAgentBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

export async function authenticateNativeAgentRequest(request: Request) {
  const accessToken = nativeAgentBearerToken(request);
  if (!accessToken) return { status: "invalid_token" as const };

  const runtime = getRuntimeEnvironment();
  return db.$transaction((tx) =>
    authenticateAgentAccessToken(tx, {
      accessToken,
      pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
    }),
  );
}

export async function verifyNativeCurrentPassword(
  userId: string,
  password: string,
): Promise<"valid" | "invalid" | "provider_unavailable"> {
  const credential = await db.passwordCredential.findUnique({
    where: { userId },
    select: { passwordHash: true },
  });
  if (!credential) return "invalid";
  try {
    return (await verifyPassword(credential.passwordHash, password))
      ? "valid"
      : "invalid";
  } catch {
    return "provider_unavailable";
  }
}

export async function verifyNativeMfaProof(
  userId: string,
  challengeToken: string,
  code: string,
): Promise<
  | {
      readonly status: "verified";
      readonly authenticationMethod: IdentityLoginMfaAuthenticationMethod;
    }
  | {
      readonly status: "invalid";
      readonly code: "INVALID_MFA_CHALLENGE" | "INVALID_MFA_CODE";
    }
  | { readonly status: "failed" }
> {
  const application = await getV2WebApplication();
  const verification = application.get<IdentityLoginMfaVerificationCapability>(
    IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID,
  );
  const result = await verification.verify({ challengeToken, code });
  if (result.status === "INVALID") {
    return {
      status: "invalid",
      code:
        result.code === "INVALID_CHALLENGE"
          ? "INVALID_MFA_CHALLENGE"
          : "INVALID_MFA_CODE",
    };
  }
  if (result.status === "FAILED") return { status: "failed" };
  if (result.userId !== userId) {
    return { status: "invalid", code: "INVALID_MFA_CHALLENGE" };
  }
  return {
    status: "verified",
    authenticationMethod: result.authenticationMethod,
  };
}

export async function issueTransientNativeMfaSession(
  userId: string,
  authenticationMethod: IdentityLoginMfaAuthenticationMethod,
): Promise<
  | { readonly status: "issued"; readonly token: string }
  | { readonly status: "failed" }
> {
  const application = await getV2WebApplication();
  const issuance = application.get<IdentitySessionIssuanceCapability>(
    IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID,
  );
  const result = await issuance.issue({
    userId,
    authenticationMethod,
    userAgentSummary: "BKE native account security",
    networkHint: "agent-session",
  });
  if (result.status !== "ISSUED") return { status: "failed" };
  return { status: "issued", token: result.token };
}

export async function revokeNativeAgentSessionsForUser(
  userId: string,
): Promise<void> {
  await db.$transaction((tx) =>
    revokeAgentAccountSessionsForUser(tx, userId, new Date()),
  );
}


export async function completeNativeBkeHandoff(
  principal: IdentityPrincipal,
  input: Readonly<{
    customerAccountId?: string;
    deviceId: string;
    deviceName?: string;
    platform: "windows" | "macos" | "linux";
    architecture: "x64" | "arm64" | "x86";
  }>,
) {
  const runtime = getRuntimeEnvironment();
  return db.$transaction(async (tx) => {
    const accounts = await resolveNativeBkeAccounts(tx, principal.id);
    if (!input.customerAccountId && accounts.length !== 1) {
      return { status: "account_selection_required" as const, accounts };
    }

    const accountId = input.customerAccountId ?? accounts[0]?.id;
    if (!accountId) {
      return { status: "account_selection_required" as const, accounts };
    }

    const handoff = await issueNativeBkeAgentHandoff(tx, {
      principal,
      accountId,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      platform: input.platform,
      architecture: input.architecture,
      pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
    });
    return { status: "handoff_issued" as const, handoff };
  }, { isolationLevel: "Serializable" });
}

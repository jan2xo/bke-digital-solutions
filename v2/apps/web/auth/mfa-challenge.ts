import "server-only";

import { cookies } from "next/headers";
import {
  IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID,
  type IdentityIssuedLoginMfaChallenge,
  type IdentityLoginMfaChallengeIssuanceCapability,
} from "@bke/identity/contracts/login-mfa-challenge.contract";
import {
  IDENTITY_LOGIN_MFA_CHALLENGE_REISSUE_CAPABILITY_ID,
  type IdentityLoginMfaChallengeReissueCapability,
} from "@bke/identity/contracts/login-mfa-challenge-reissue.contract";
import {
  IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID,
  type IdentityLoginMfaAuthenticationMethod,
  type IdentityLoginMfaVerificationCapability,
} from "@bke/identity/contracts/login-mfa-verification.contract";
import { audit } from "@/v2/apps/web/audit";
import { sendAdministratorLoginCode } from "@/lib/email";
import { getV2WebApplication } from "../runtime";

export const IDENTITY_MFA_CHALLENGE_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-bke_mfa_challenge" : "bke_mfa_challenge";

export const IDENTITY_MFA_CHALLENGE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: 10 * 60,
};

export class IdentityCapabilityError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 503) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function currentIdentityMfaChallengeToken(): Promise<string | null> {
  return (await cookies()).get(IDENTITY_MFA_CHALLENGE_COOKIE)?.value ?? null;
}

export async function deliverIdentityMfaChallenge(input: {
  readonly userId: string;
  readonly purpose: "LOGIN" | "RECENT_AUTH" | "ENROLLMENT";
  readonly delivery: {
    readonly recipientEmail: string;
    readonly code: string;
    readonly reference: string;
  };
}): Promise<boolean> {
  try {
    await sendAdministratorLoginCode(
      input.delivery.recipientEmail,
      input.delivery.code,
      input.delivery.reference,
    );
    return true;
  } catch {
    await audit({
      actorId: input.userId,
      action: "EMAIL_DELIVERY_FAILED",
      targetType: "MfaChallenge",
      targetId: "delivery",
      metadata: { provider: "resend", purpose: input.purpose },
    }).catch(() => undefined);
    return false;
  }
}

async function deliveredLoginChallenge(
  userId: string,
  challenge: IdentityIssuedLoginMfaChallenge,
): Promise<{ token: string; delivered: boolean; reference: string }> {
  return {
    token: challenge.challengeToken,
    delivered: await deliverIdentityMfaChallenge({
      userId,
      purpose: "LOGIN",
      delivery: challenge.delivery,
    }),
    reference: challenge.delivery.reference,
  };
}

export async function issueIdentityLoginMfaChallenge(
  userId: string,
): Promise<{ token: string; delivered: boolean; reference: string }> {
  const application = await getV2WebApplication();
  const issuance = application.get<IdentityLoginMfaChallengeIssuanceCapability>(
    IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID,
  );
  const result = await issuance.issue({ userId });
  if (result.status === "REJECTED") throw new Error(result.code);
  if (result.status === "FAILED") throw new IdentityCapabilityError(result.code);
  return deliveredLoginChallenge(userId, result.challenge);
}

export async function reissueIdentityLoginMfaChallenge(): Promise<{
  token: string;
  delivered: boolean;
  reference: string;
}> {
  const challengeToken = await currentIdentityMfaChallengeToken();
  if (!challengeToken) throw new Error("INVALID_MFA_CHALLENGE");

  const application = await getV2WebApplication();
  const reissue = application.get<IdentityLoginMfaChallengeReissueCapability>(
    IDENTITY_LOGIN_MFA_CHALLENGE_REISSUE_CAPABILITY_ID,
  );
  const result = await reissue.reissue({ challengeToken });
  if (result.status === "REJECTED") {
    throw new Error(
      result.code === "PRINCIPAL_NOT_FOUND" ? "INVALID_MFA_CHALLENGE" : result.code,
    );
  }
  if (result.status === "FAILED") throw new IdentityCapabilityError(result.code);
  return deliveredLoginChallenge(
    result.challenge.delivery.recipientEmail,
    result.challenge,
  );
}

export async function verifyIdentityLoginMfaChallenge(code: string): Promise<{
  userId: string;
  recoveryUsed: boolean;
  authenticationMethod: IdentityLoginMfaAuthenticationMethod;
}> {
  const challengeToken = await currentIdentityMfaChallengeToken();
  if (!challengeToken) throw new Error("INVALID_MFA_CHALLENGE");

  const application = await getV2WebApplication();
  const verification = application.get<IdentityLoginMfaVerificationCapability>(
    IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID,
  );
  const result = await verification.verify({ challengeToken, code });
  if (result.status === "INVALID") {
    throw new Error(
      result.code === "INVALID_CHALLENGE" ? "INVALID_MFA_CHALLENGE" : "INVALID_MFA_CODE",
    );
  }
  if (result.status === "FAILED") throw new IdentityCapabilityError(result.code);
  return {
    userId: result.userId,
    recoveryUsed: result.authenticationMethod === "PASSWORD_RECOVERY",
    authenticationMethod: result.authenticationMethod,
  };
}

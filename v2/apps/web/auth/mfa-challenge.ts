import "server-only";
import { cookies } from "next/headers";
import { audit } from "@/lib/audit";
import { sendAdministratorLoginCode } from "@/lib/email";

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

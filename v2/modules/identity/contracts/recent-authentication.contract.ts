export const IDENTITY_RECENT_AUTHENTICATION_CAPABILITY_ID =
  "bke.identity.recent-authentication.v1" as const;

export type IdentityRecentAuthenticationMethod =
  | "PASSWORD"
  | "PASSWORD_EMAIL_OTP"
  | "PASSWORD_RECOVERY";

export interface IdentityRecentAuthenticationInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly password: string;
  readonly challengeToken?: string;
  readonly code?: string;
}

export type IdentityRecentAuthenticationResult =
  | {
      readonly status: "AUTHENTICATED";
      readonly sessionId: string;
      readonly userId: string;
      readonly recentAuthenticatedAt: Date;
      readonly authenticationMethod: IdentityRecentAuthenticationMethod;
    }
  | {
      readonly status: "INVALID";
      readonly code:
        | "INVALID_INPUT"
        | "INVALID_SESSION"
        | "INVALID_CREDENTIALS"
        | "MFA_PROOF_REQUIRED"
        | "INVALID_CHALLENGE"
        | "INVALID_CODE";
    }
  | {
      readonly status: "FAILED";
      readonly code: "CODE_PROVIDER_UNAVAILABLE" | "PERSISTENCE_UNAVAILABLE";
    };

export interface IdentityRecentAuthenticationCapability {
  authenticate(
    input: IdentityRecentAuthenticationInput,
  ): Promise<IdentityRecentAuthenticationResult>;
}

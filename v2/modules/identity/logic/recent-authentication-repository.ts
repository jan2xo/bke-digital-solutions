export interface IdentityRecentAuthenticationContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly userRole: "CUSTOMER" | "ADMIN";
  readonly passwordHash: string;
  readonly mfaVerifiedAt: Date | null;
  readonly administratorMfaEnabled: boolean;
}

export interface IdentityRecentAuthenticationChallengeRecord {
  readonly id: string;
  readonly userId: string;
  readonly purpose: "LOGIN" | "ENROLLMENT" | "RECENT_AUTH";
  readonly codeHash: string | null;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly attemptCount: number;
}

export interface IdentityRecentAuthenticationRecoveryCodeRecord {
  readonly id: string;
}

export type IdentityRecentAuthenticationCommitResult =
  | "UPDATED"
  | "SESSION_REJECTED"
  | "CHALLENGE_REJECTED"
  | "RECOVERY_REJECTED";

export interface IdentityRecentAuthenticationRepository {
  findContext(
    sessionId: string,
    userId: string,
    now: Date,
  ): Promise<IdentityRecentAuthenticationContext | null>;

  findChallenge(
    userId: string,
    tokenHash: string,
  ): Promise<IdentityRecentAuthenticationChallengeRecord | null>;

  findUnusedRecoveryCode(
    userId: string,
    codeHash: string,
  ): Promise<IdentityRecentAuthenticationRecoveryCodeRecord | null>;

  incrementChallengeAttempt(challengeId: string): Promise<void>;

  upgradeCustomerSession(
    sessionId: string,
    userId: string,
    authenticatedAt: Date,
  ): Promise<IdentityRecentAuthenticationCommitResult>;

  completeAdminRecentAuthentication(input: {
    readonly sessionId: string;
    readonly userId: string;
    readonly challengeId: string;
    readonly recoveryCodeId: string | null;
    readonly authenticatedAt: Date;
  }): Promise<IdentityRecentAuthenticationCommitResult>;
}

import type {
  IdentityRecentAuthenticationCapability,
  IdentityRecentAuthenticationInput,
  IdentityRecentAuthenticationResult,
} from "../contracts/recent-authentication.contract";
import type { IdentityEmailMfaProofProvider } from "./email-mfa-proof-provider";
import type { IdentityPasswordVerifier } from "./password-verifier";
import type { IdentityRecentAuthenticationRepository } from "./recent-authentication-repository";

const MAX_PASSWORD_LENGTH = 128;

export function createIdentityRecentAuthenticationCapability(
  repository: IdentityRecentAuthenticationRepository,
  passwordVerifier: IdentityPasswordVerifier,
  mfaProofProvider: IdentityEmailMfaProofProvider,
  clock: () => Date = () => new Date(),
): IdentityRecentAuthenticationCapability {
  return Object.freeze({
    async authenticate(
      input: IdentityRecentAuthenticationInput,
    ): Promise<IdentityRecentAuthenticationResult> {
      const sessionId = input.sessionId.trim();
      const userId = input.userId.trim();
      if (
        !sessionId ||
        !userId ||
        input.password.length < 1 ||
        input.password.length > MAX_PASSWORD_LENGTH
      ) {
        return { status: "INVALID", code: "INVALID_INPUT" };
      }

      const now = clock();
      let context;
      try {
        context = await repository.findContext(sessionId, userId, now);
      } catch {
        return { status: "FAILED", code: "PERSISTENCE_UNAVAILABLE" };
      }
      if (!context) {
        return { status: "INVALID", code: "INVALID_SESSION" };
      }

      let passwordValid = false;
      try {
        passwordValid = await passwordVerifier.verify(
          context.passwordHash,
          input.password,
        );
      } catch {
        passwordValid = false;
      }
      if (!passwordValid) {
        return { status: "INVALID", code: "INVALID_CREDENTIALS" };
      }

      if (context.userRole === "CUSTOMER") {
        try {
          const committed = await repository.upgradeCustomerSession(
            sessionId,
            userId,
            now,
          );
          if (committed !== "UPDATED") {
            return { status: "INVALID", code: "INVALID_SESSION" };
          }
        } catch {
          return { status: "FAILED", code: "PERSISTENCE_UNAVAILABLE" };
        }

        return {
          status: "AUTHENTICATED",
          sessionId,
          userId,
          recentAuthenticatedAt: now,
          authenticationMethod: "PASSWORD",
        };
      }

      if (!context.administratorMfaEnabled || !context.mfaVerifiedAt) {
        return { status: "INVALID", code: "INVALID_SESSION" };
      }

      const challengeToken = input.challengeToken?.trim() ?? "";
      const code = input.code?.trim() ?? "";
      if (!challengeToken || code.length < 6 || code.length > 32) {
        return { status: "INVALID", code: "MFA_PROOF_REQUIRED" };
      }

      let tokenHash: string;
      try {
        tokenHash = mfaProofProvider.hashChallengeToken(challengeToken);
      } catch {
        return { status: "FAILED", code: "CODE_PROVIDER_UNAVAILABLE" };
      }

      let challenge;
      try {
        challenge = await repository.findChallenge(userId, tokenHash);
      } catch {
        return { status: "FAILED", code: "PERSISTENCE_UNAVAILABLE" };
      }
      if (
        !challenge ||
        challenge.userId !== userId ||
        challenge.purpose !== "RECENT_AUTH" ||
        challenge.consumedAt ||
        challenge.expiresAt <= now ||
        challenge.attemptCount >= 5
      ) {
        return { status: "INVALID", code: "INVALID_CHALLENGE" };
      }

      let emailCodeValid: boolean;
      let recoveryCodeHash: string;
      try {
        emailCodeValid = Boolean(
          challenge.codeHash &&
            mfaProofProvider.verifyEmailCode(challenge.codeHash, code),
        );
        recoveryCodeHash = mfaProofProvider.hashRecoveryCode(code);
      } catch {
        return { status: "FAILED", code: "CODE_PROVIDER_UNAVAILABLE" };
      }

      let recovery = null;
      try {
        if (!emailCodeValid) {
          recovery = await repository.findUnusedRecoveryCode(
            userId,
            recoveryCodeHash,
          );
        }
      } catch {
        return { status: "FAILED", code: "PERSISTENCE_UNAVAILABLE" };
      }

      if (!emailCodeValid && !recovery) {
        try {
          await repository.incrementChallengeAttempt(challenge.id);
        } catch {
          return { status: "FAILED", code: "PERSISTENCE_UNAVAILABLE" };
        }
        return { status: "INVALID", code: "INVALID_CODE" };
      }

      let committed;
      try {
        committed = await repository.completeAdminRecentAuthentication({
          sessionId,
          userId,
          challengeId: challenge.id,
          recoveryCodeId: recovery?.id ?? null,
          authenticatedAt: now,
        });
      } catch {
        return { status: "FAILED", code: "PERSISTENCE_UNAVAILABLE" };
      }

      if (committed === "SESSION_REJECTED") {
        return { status: "INVALID", code: "INVALID_SESSION" };
      }
      if (committed === "CHALLENGE_REJECTED") {
        return { status: "INVALID", code: "INVALID_CHALLENGE" };
      }
      if (committed === "RECOVERY_REJECTED") {
        return { status: "INVALID", code: "INVALID_CODE" };
      }

      return {
        status: "AUTHENTICATED",
        sessionId,
        userId,
        recentAuthenticatedAt: now,
        authenticationMethod: recovery
          ? "PASSWORD_RECOVERY"
          : "PASSWORD_EMAIL_OTP",
      };
    },
  });
}

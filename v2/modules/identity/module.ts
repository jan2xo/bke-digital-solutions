import type { CapabilityModule } from "../../contracts/capability";
import { IDENTITY_EMAIL_VERIFICATION_COMPLETION_CAPABILITY_ID } from "./contracts/email-verification-completion.contract";
import { IDENTITY_EMAIL_VERIFICATION_ISSUANCE_CAPABILITY_ID } from "./contracts/email-verification-issuance.contract";
import {
  IDENTITY_LOOKUP_CAPABILITY_ID,
  IDENTITY_PASSWORD_AUTHENTICATION_CAPABILITY_ID,
} from "./contracts/identity.contract";
import { IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID } from "./contracts/login-mfa-challenge.contract";
import { IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID } from "./contracts/login-mfa-verification.contract";
import { IDENTITY_MAGIC_LOGIN_CONSUME_CAPABILITY_ID } from "./contracts/magic-login-consume.contract";
import { IDENTITY_MAGIC_LOGIN_REQUEST_CAPABILITY_ID } from "./contracts/magic-login-request.contract";
import { IDENTITY_MFA_DISABLE_CAPABILITY_ID } from "./contracts/mfa-disable.contract";
import { IDENTITY_MFA_EMERGENCY_ENROLLMENT_CAPABILITY_ID } from "./contracts/mfa-emergency-enrollment.contract";
import { IDENTITY_MFA_ENROLLMENT_COMPLETION_CAPABILITY_ID } from "./contracts/mfa-enrollment-completion.contract";
import { IDENTITY_MFA_ENROLLMENT_START_CAPABILITY_ID } from "./contracts/mfa-enrollment-start.contract";
import { IDENTITY_MFA_RECOVERY_REGENERATION_CAPABILITY_ID } from "./contracts/mfa-recovery-regeneration.contract";
import { IDENTITY_PASSWORD_CHANGE_CAPABILITY_ID } from "./contracts/password-change.contract";
import { IDENTITY_PASSWORD_RESET_COMPLETION_CAPABILITY_ID } from "./contracts/password-reset-completion.contract";
import { IDENTITY_PASSWORD_RESET_REQUEST_CAPABILITY_ID } from "./contracts/password-reset-request.contract";
import { IDENTITY_RECENT_AUTH_CHALLENGE_ISSUANCE_CAPABILITY_ID } from "./contracts/recent-auth-challenge.contract";
import { IDENTITY_RECENT_AUTH_COMPLETION_CAPABILITY_ID } from "./contracts/recent-auth-completion.contract";
import { IDENTITY_SESSION_TERMINATION_CAPABILITY_ID } from "./contracts/session-termination.contract";
import { IDENTITY_SESSION_VALIDATION_CAPABILITY_ID } from "./contracts/session-validation.contract";
import { IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID } from "./contracts/session.contract";
import { createIdentityEmailVerificationCompletionCapability } from "./logic/email-verification-completion";
import { createIdentityEmailVerificationIssuanceCapability } from "./logic/email-verification-issuance";
import { createIdentityLookupCapability } from "./logic/identity-service";
import { createIdentityLoginMfaChallengeIssuanceCapability } from "./logic/login-mfa-challenge-issuance";
import { createIdentityLoginMfaVerificationCapability } from "./logic/login-mfa-verification";
import { createIdentityMagicLoginConsumeCapability } from "./logic/magic-login-consume";
import { createIdentityMagicLoginRequestCapability } from "./logic/magic-login-request";
import { createIdentityMfaDisableCapability } from "./logic/mfa-disable";
import { createIdentityMfaEmergencyEnrollmentCapability } from "./logic/mfa-emergency-enrollment";
import { createIdentityMfaEnrollmentCompletionCapability } from "./logic/mfa-enrollment-completion";
import { createIdentityMfaEnrollmentStartCapability } from "./logic/mfa-enrollment-start";
import { createIdentityMfaRecoveryRegenerationCapability } from "./logic/mfa-recovery-regeneration";
import { createIdentityPasswordAuthenticationCapability } from "./logic/password-authentication";
import { createIdentityPasswordChangeCapability } from "./logic/password-change";
import { createIdentityPasswordResetCompletionCapability } from "./logic/password-reset-completion";
import { createIdentityPasswordResetRequestCapability } from "./logic/password-reset-request";
import { createArgon2PasswordHasher } from "./logic/providers/argon2-password-hasher";
import { createArgon2PasswordVerifier } from "./logic/providers/argon2-password-verifier";
import { createHmacEmailMfaChallengeMaterialProvider } from "./logic/providers/hmac-email-mfa-challenge-material-provider";
import { createHmacEmailMfaProofProvider } from "./logic/providers/hmac-email-mfa-proof-provider";
import { createHmacEmailVerificationTokenProvider } from "./logic/providers/hmac-email-verification-token-provider";
import { createHmacMagicLoginTokenProvider } from "./logic/providers/hmac-magic-login-token-provider";
import { createHmacMfaRecoveryCodeProvider } from "./logic/providers/hmac-mfa-recovery-code-provider";
import { createHmacPasswordResetTokenProvider } from "./logic/providers/hmac-password-reset-token-provider";
import { createHmacSessionTokenProvider } from "./logic/providers/hmac-session-token-provider";
import { createIdentityRecentAuthChallengeIssuanceCapability } from "./logic/recent-auth-challenge-issuance";
import { createIdentityRecentAuthCompletionCapability } from "./logic/recent-auth-completion";
import { createIdentitySessionIssuanceCapability } from "./logic/session-issuance";
import { createIdentitySessionTerminationCapability } from "./logic/session-termination";
import { createIdentitySessionValidationCapability } from "./logic/session-validation";
import { identityModuleManifest } from "./module.manifest";
import { createPostgresIdentityEmailVerificationCompletionRepository } from "./prisma/repositories/postgres-email-verification-completion-repository";
import { createPostgresIdentityEmailVerificationIssuanceRepository } from "./prisma/repositories/postgres-email-verification-issuance-repository";
import { createPostgresIdentityLoginMfaChallengeRepository } from "./prisma/repositories/postgres-login-mfa-challenge-repository";
import { createPostgresIdentityLoginMfaRepository } from "./prisma/repositories/postgres-login-mfa-repository";
import { createPostgresIdentityMagicLoginConsumeRepository } from "./prisma/repositories/postgres-magic-login-consume-repository";
import { createPostgresIdentityMagicLoginRequestRepository } from "./prisma/repositories/postgres-magic-login-request-repository";
import { createPostgresIdentityMfaDisableRepository } from "./prisma/repositories/postgres-mfa-disable-repository";
import { createPostgresIdentityMfaEmergencyEnrollmentRepository } from "./prisma/repositories/postgres-mfa-emergency-enrollment-repository";
import { createPostgresIdentityMfaEnrollmentCompletionRepository } from "./prisma/repositories/postgres-mfa-enrollment-completion-repository";
import { createPostgresIdentityMfaEnrollmentStartRepository } from "./prisma/repositories/postgres-mfa-enrollment-start-repository";
import { createPostgresIdentityMfaRecoveryRegenerationRepository } from "./prisma/repositories/postgres-mfa-recovery-regeneration-repository";
import { createPostgresIdentityPasswordChangeRepository } from "./prisma/repositories/postgres-password-change-repository";
import { createPostgresIdentityPasswordResetCompletionRepository } from "./prisma/repositories/postgres-password-reset-completion-repository";
import { createPostgresIdentityPasswordResetRequestRepository } from "./prisma/repositories/postgres-password-reset-request-repository";
import { createPostgresIdentityRecentAuthChallengeRepository } from "./prisma/repositories/postgres-recent-auth-challenge-repository";
import { createPostgresIdentityRecentAuthCompletionRepository } from "./prisma/repositories/postgres-recent-auth-completion-repository";
import { createPostgresIdentityRepository } from "./prisma/repositories/postgres-identity-repository";
import { createPostgresIdentitySessionRepository } from "./prisma/repositories/postgres-session-repository";
import { createPostgresIdentitySessionTerminationRepository } from "./prisma/repositories/postgres-session-termination-repository";

export interface IdentityModuleOptions {
  readonly connectionString: string;
  readonly sessionSecret: string;
  readonly mfaEncryptionKey?: string;
}

export function createIdentityModule(
  options: IdentityModuleOptions,
): CapabilityModule {
  const repository = createPostgresIdentityRepository(options.connectionString);
  const passwordVerifier = createArgon2PasswordVerifier();
  const passwordHasher = createArgon2PasswordHasher();
  const passwordChangeRepository = createPostgresIdentityPasswordChangeRepository(
    options.connectionString,
  );
  const sessionRepository = createPostgresIdentitySessionRepository(
    options.connectionString,
  );
  const sessionTerminationRepository =
    createPostgresIdentitySessionTerminationRepository(options.connectionString);
  const loginMfaRepository = createPostgresIdentityLoginMfaRepository(
    options.connectionString,
  );
  const loginMfaChallengeRepository =
    createPostgresIdentityLoginMfaChallengeRepository(options.connectionString);
  const emailVerificationIssuanceRepository =
    createPostgresIdentityEmailVerificationIssuanceRepository(
      options.connectionString,
    );
  const emailVerificationCompletionRepository =
    createPostgresIdentityEmailVerificationCompletionRepository(
      options.connectionString,
    );
  const magicLoginRequestRepository =
    createPostgresIdentityMagicLoginRequestRepository(options.connectionString);
  const magicLoginConsumeRepository =
    createPostgresIdentityMagicLoginConsumeRepository(options.connectionString);
  const mfaEnrollmentStartRepository =
    createPostgresIdentityMfaEnrollmentStartRepository(options.connectionString);
  const mfaEnrollmentCompletionRepository =
    createPostgresIdentityMfaEnrollmentCompletionRepository(options.connectionString);
  const mfaDisableRepository = createPostgresIdentityMfaDisableRepository(
    options.connectionString,
  );
  const mfaRecoveryRegenerationRepository =
    createPostgresIdentityMfaRecoveryRegenerationRepository(
      options.connectionString,
    );
  const mfaEmergencyEnrollmentRepository =
    createPostgresIdentityMfaEmergencyEnrollmentRepository(
      options.connectionString,
    );
  const recentAuthChallengeRepository =
    createPostgresIdentityRecentAuthChallengeRepository(options.connectionString);
  const recentAuthCompletionRepository =
    createPostgresIdentityRecentAuthCompletionRepository(options.connectionString);
  const passwordResetRequestRepository =
    createPostgresIdentityPasswordResetRequestRepository(options.connectionString);
  const passwordResetCompletionRepository =
    createPostgresIdentityPasswordResetCompletionRepository(options.connectionString);
  const sessionTokenProvider = createHmacSessionTokenProvider(options.sessionSecret);
  const emailVerificationTokenProvider =
    createHmacEmailVerificationTokenProvider(options.sessionSecret);
  const magicLoginTokenProvider = createHmacMagicLoginTokenProvider(options.sessionSecret);
  const passwordResetTokenProvider = createHmacPasswordResetTokenProvider(
    options.sessionSecret,
  );
  const emailMfaProofProvider = createHmacEmailMfaProofProvider(
    options.sessionSecret,
    options.mfaEncryptionKey,
  );
  const emailMfaChallengeMaterialProvider =
    createHmacEmailMfaChallengeMaterialProvider(
      options.sessionSecret,
      options.mfaEncryptionKey,
    );
  const mfaRecoveryCodeProvider = createHmacMfaRecoveryCodeProvider(
    options.sessionSecret,
    options.mfaEncryptionKey,
  );
  const sessionValidation = createIdentitySessionValidationCapability(
    sessionRepository,
    sessionTokenProvider,
  );

  return Object.freeze({
    manifest: identityModuleManifest,
    start() {
      return [
        {
          id: IDENTITY_LOOKUP_CAPABILITY_ID,
          value: createIdentityLookupCapability(repository),
        },
        {
          id: IDENTITY_PASSWORD_AUTHENTICATION_CAPABILITY_ID,
          value: createIdentityPasswordAuthenticationCapability(
            repository,
            passwordVerifier,
          ),
        },
        {
          id: IDENTITY_EMAIL_VERIFICATION_ISSUANCE_CAPABILITY_ID,
          value: createIdentityEmailVerificationIssuanceCapability(
            emailVerificationIssuanceRepository,
            emailVerificationTokenProvider,
          ),
        },
        {
          id: IDENTITY_EMAIL_VERIFICATION_COMPLETION_CAPABILITY_ID,
          value: createIdentityEmailVerificationCompletionCapability(
            emailVerificationCompletionRepository,
            emailVerificationTokenProvider,
          ),
        },
        {
          id: IDENTITY_PASSWORD_CHANGE_CAPABILITY_ID,
          value: createIdentityPasswordChangeCapability(
            passwordChangeRepository,
            sessionValidation,
            passwordVerifier,
            passwordHasher,
          ),
        },
        {
          id: IDENTITY_MAGIC_LOGIN_REQUEST_CAPABILITY_ID,
          value: createIdentityMagicLoginRequestCapability(
            magicLoginRequestRepository,
            magicLoginTokenProvider,
          ),
        },
        {
          id: IDENTITY_MAGIC_LOGIN_CONSUME_CAPABILITY_ID,
          value: createIdentityMagicLoginConsumeCapability(
            magicLoginConsumeRepository,
            magicLoginTokenProvider,
            sessionTokenProvider,
          ),
        },
        {
          id: IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID,
          value: createIdentitySessionIssuanceCapability(
            sessionRepository,
            sessionTokenProvider,
          ),
        },
        {
          id: IDENTITY_SESSION_VALIDATION_CAPABILITY_ID,
          value: sessionValidation,
        },
        {
          id: IDENTITY_SESSION_TERMINATION_CAPABILITY_ID,
          value: createIdentitySessionTerminationCapability(
            sessionTerminationRepository,
            sessionTokenProvider,
          ),
        },
        {
          id: IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID,
          value: createIdentityLoginMfaVerificationCapability(
            loginMfaRepository,
            emailMfaProofProvider,
          ),
        },
        {
          id: IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID,
          value: createIdentityLoginMfaChallengeIssuanceCapability(
            loginMfaChallengeRepository,
            emailMfaChallengeMaterialProvider,
          ),
        },
        {
          id: IDENTITY_MFA_ENROLLMENT_START_CAPABILITY_ID,
          value: createIdentityMfaEnrollmentStartCapability(
            mfaEnrollmentStartRepository,
            emailMfaChallengeMaterialProvider,
          ),
        },
        {
          id: IDENTITY_MFA_ENROLLMENT_COMPLETION_CAPABILITY_ID,
          value: createIdentityMfaEnrollmentCompletionCapability(
            mfaEnrollmentCompletionRepository,
            emailMfaProofProvider,
            mfaRecoveryCodeProvider,
          ),
        },
        {
          id: IDENTITY_MFA_DISABLE_CAPABILITY_ID,
          value: createIdentityMfaDisableCapability(mfaDisableRepository),
        },
        {
          id: IDENTITY_MFA_RECOVERY_REGENERATION_CAPABILITY_ID,
          value: createIdentityMfaRecoveryRegenerationCapability(
            mfaRecoveryRegenerationRepository,
            sessionValidation,
            mfaRecoveryCodeProvider,
          ),
        },
        {
          id: IDENTITY_MFA_EMERGENCY_ENROLLMENT_CAPABILITY_ID,
          value: createIdentityMfaEmergencyEnrollmentCapability(
            mfaEmergencyEnrollmentRepository,
            sessionValidation,
            sessionTokenProvider,
            mfaRecoveryCodeProvider,
          ),
        },
        {
          id: IDENTITY_RECENT_AUTH_CHALLENGE_ISSUANCE_CAPABILITY_ID,
          value: createIdentityRecentAuthChallengeIssuanceCapability(
            recentAuthChallengeRepository,
            emailMfaChallengeMaterialProvider,
          ),
        },
        {
          id: IDENTITY_RECENT_AUTH_COMPLETION_CAPABILITY_ID,
          value: createIdentityRecentAuthCompletionCapability(
            recentAuthCompletionRepository,
            sessionValidation,
            passwordVerifier,
            emailMfaProofProvider,
          ),
        },
        {
          id: IDENTITY_PASSWORD_RESET_REQUEST_CAPABILITY_ID,
          value: createIdentityPasswordResetRequestCapability(
            passwordResetRequestRepository,
            passwordResetTokenProvider,
          ),
        },
        {
          id: IDENTITY_PASSWORD_RESET_COMPLETION_CAPABILITY_ID,
          value: createIdentityPasswordResetCompletionCapability(
            passwordResetCompletionRepository,
            passwordResetTokenProvider,
            passwordHasher,
          ),
        },
      ];
    },
  });
}

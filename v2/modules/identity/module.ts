import type { CapabilityModule } from "../../contracts/capability";
import {
  IDENTITY_LOOKUP_CAPABILITY_ID,
  IDENTITY_PASSWORD_AUTHENTICATION_CAPABILITY_ID,
} from "./contracts/identity.contract";
import { IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID } from "./contracts/login-mfa-challenge.contract";
import { IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID } from "./contracts/login-mfa-verification.contract";
import { IDENTITY_MFA_DISABLE_CAPABILITY_ID } from "./contracts/mfa-disable.contract";
import { IDENTITY_MFA_ENROLLMENT_COMPLETION_CAPABILITY_ID } from "./contracts/mfa-enrollment-completion.contract";
import { IDENTITY_MFA_ENROLLMENT_START_CAPABILITY_ID } from "./contracts/mfa-enrollment-start.contract";
import { IDENTITY_RECENT_AUTH_CHALLENGE_ISSUANCE_CAPABILITY_ID } from "./contracts/recent-auth-challenge.contract";
import { IDENTITY_SESSION_TERMINATION_CAPABILITY_ID } from "./contracts/session-termination.contract";
import { IDENTITY_SESSION_VALIDATION_CAPABILITY_ID } from "./contracts/session-validation.contract";
import { IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID } from "./contracts/session.contract";
import { createIdentityLookupCapability } from "./logic/identity-service";
import { createIdentityLoginMfaChallengeIssuanceCapability } from "./logic/login-mfa-challenge-issuance";
import { createIdentityLoginMfaVerificationCapability } from "./logic/login-mfa-verification";
import { createIdentityMfaDisableCapability } from "./logic/mfa-disable";
import { createIdentityMfaEnrollmentCompletionCapability } from "./logic/mfa-enrollment-completion";
import { createIdentityMfaEnrollmentStartCapability } from "./logic/mfa-enrollment-start";
import { createIdentityPasswordAuthenticationCapability } from "./logic/password-authentication";
import { createArgon2PasswordVerifier } from "./logic/providers/argon2-password-verifier";
import { createHmacEmailMfaChallengeMaterialProvider } from "./logic/providers/hmac-email-mfa-challenge-material-provider";
import { createHmacEmailMfaProofProvider } from "./logic/providers/hmac-email-mfa-proof-provider";
import { createHmacMfaRecoveryCodeProvider } from "./logic/providers/hmac-mfa-recovery-code-provider";
import { createHmacSessionTokenProvider } from "./logic/providers/hmac-session-token-provider";
import { createIdentityRecentAuthChallengeIssuanceCapability } from "./logic/recent-auth-challenge-issuance";
import { createIdentitySessionIssuanceCapability } from "./logic/session-issuance";
import { createIdentitySessionTerminationCapability } from "./logic/session-termination";
import { createIdentitySessionValidationCapability } from "./logic/session-validation";
import { identityModuleManifest } from "./module.manifest";
import { createPostgresIdentityLoginMfaChallengeRepository } from "./prisma/repositories/postgres-login-mfa-challenge-repository";
import { createPostgresIdentityLoginMfaRepository } from "./prisma/repositories/postgres-login-mfa-repository";
import { createPostgresIdentityMfaDisableRepository } from "./prisma/repositories/postgres-mfa-disable-repository";
import { createPostgresIdentityMfaEnrollmentCompletionRepository } from "./prisma/repositories/postgres-mfa-enrollment-completion-repository";
import { createPostgresIdentityMfaEnrollmentStartRepository } from "./prisma/repositories/postgres-mfa-enrollment-start-repository";
import { createPostgresIdentityRecentAuthChallengeRepository } from "./prisma/repositories/postgres-recent-auth-challenge-repository";
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
  const mfaEnrollmentStartRepository =
    createPostgresIdentityMfaEnrollmentStartRepository(options.connectionString);
  const mfaEnrollmentCompletionRepository =
    createPostgresIdentityMfaEnrollmentCompletionRepository(options.connectionString);
  const mfaDisableRepository = createPostgresIdentityMfaDisableRepository(
    options.connectionString,
  );
  const recentAuthChallengeRepository =
    createPostgresIdentityRecentAuthChallengeRepository(options.connectionString);
  const sessionTokenProvider = createHmacSessionTokenProvider(options.sessionSecret);
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
          id: IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID,
          value: createIdentitySessionIssuanceCapability(
            sessionRepository,
            sessionTokenProvider,
          ),
        },
        {
          id: IDENTITY_SESSION_VALIDATION_CAPABILITY_ID,
          value: createIdentitySessionValidationCapability(
            sessionRepository,
            sessionTokenProvider,
          ),
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
          id: IDENTITY_RECENT_AUTH_CHALLENGE_ISSUANCE_CAPABILITY_ID,
          value: createIdentityRecentAuthChallengeIssuanceCapability(
            recentAuthChallengeRepository,
            emailMfaChallengeMaterialProvider,
          ),
        },
      ];
    },
  });
}

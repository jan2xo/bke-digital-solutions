import type { CapabilityModule } from "../../contracts/capability";
import { IDENTITY_GOOGLE_AUTHENTICATION_CAPABILITY_ID } from "@bke/identity/contracts/google-authentication.contract";
import { IDENTITY_GOOGLE_PRINCIPAL_BINDING_CAPABILITY_ID } from "@bke/identity/contracts/google-identity.contract";
import { createIdentityGoogleAuthenticationCapability } from "@bke/identity/logic/google-authentication";
import { createIdentityGooglePrincipalBindingCapability } from "@bke/identity/logic/google-identity";
import { createPostgresIdentityGoogleIdentityRepository } from "@bke/identity/prisma/repositories/postgres-google-identity-repository";
import { IDENTITY_EMAIL_VERIFICATION_COMPLETION_CAPABILITY_ID } from "@bke/identity/contracts/email-verification-completion.contract";
import { IDENTITY_EMAIL_VERIFICATION_ISSUANCE_CAPABILITY_ID } from "@bke/identity/contracts/email-verification-issuance.contract";
import {
  IDENTITY_LOOKUP_CAPABILITY_ID,
  IDENTITY_PASSWORD_AUTHENTICATION_CAPABILITY_ID,
} from "@bke/identity/contracts/identity.contract";
import { IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID } from "@bke/identity/contracts/login-mfa-challenge.contract";
import { IDENTITY_LOGIN_MFA_CHALLENGE_REISSUE_CAPABILITY_ID } from "@bke/identity/contracts/login-mfa-challenge-reissue.contract";
import { IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID } from "@bke/identity/contracts/login-mfa-verification.contract";
import { IDENTITY_MAGIC_LOGIN_CONSUME_CAPABILITY_ID } from "@bke/identity/contracts/magic-login-consume.contract";
import { IDENTITY_MAGIC_LOGIN_REQUEST_CAPABILITY_ID } from "@bke/identity/contracts/magic-login-request.contract";
import { IDENTITY_MFA_DISABLE_CAPABILITY_ID } from "@bke/identity/contracts/mfa-disable.contract";
import { IDENTITY_MFA_EMERGENCY_ENROLLMENT_CAPABILITY_ID } from "@bke/identity/contracts/mfa-emergency-enrollment.contract";
import { IDENTITY_MFA_ENROLLMENT_COMPLETION_CAPABILITY_ID } from "@bke/identity/contracts/mfa-enrollment-completion.contract";
import { IDENTITY_MFA_ENROLLMENT_START_CAPABILITY_ID } from "@bke/identity/contracts/mfa-enrollment-start.contract";
import { IDENTITY_MFA_RECOVERY_REGENERATION_CAPABILITY_ID } from "@bke/identity/contracts/mfa-recovery-regeneration.contract";
import { IDENTITY_PASSWORD_CHANGE_CAPABILITY_ID } from "@bke/identity/contracts/password-change.contract";
import { IDENTITY_PASSWORD_RESET_COMPLETION_CAPABILITY_ID } from "@bke/identity/contracts/password-reset-completion.contract";
import { IDENTITY_PASSWORD_RESET_REQUEST_CAPABILITY_ID } from "@bke/identity/contracts/password-reset-request.contract";
import { IDENTITY_RECENT_AUTH_CHALLENGE_ISSUANCE_CAPABILITY_ID } from "@bke/identity/contracts/recent-auth-challenge.contract";
import { IDENTITY_RECENT_AUTH_COMPLETION_CAPABILITY_ID } from "@bke/identity/contracts/recent-auth-completion.contract";
import { IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID } from "@bke/identity/contracts/session-administration.contract";
import { IDENTITY_SESSION_TERMINATION_CAPABILITY_ID } from "@bke/identity/contracts/session-termination.contract";
import { IDENTITY_SESSION_VALIDATION_CAPABILITY_ID } from "@bke/identity/contracts/session-validation.contract";
import { IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID } from "@bke/identity/contracts/session.contract";
import { createIdentityEmailVerificationCompletionCapability } from "@bke/identity/logic/email-verification-completion";
import { createIdentityEmailVerificationIssuanceCapability } from "@bke/identity/logic/email-verification-issuance";
import { createIdentityLookupCapability } from "@bke/identity/logic/identity-service";
import { createIdentityLoginMfaChallengeIssuanceCapability } from "@bke/identity/logic/login-mfa-challenge-issuance";
import { createIdentityLoginMfaChallengeReissueCapability } from "@bke/identity/logic/login-mfa-challenge-reissue";
import { createIdentityLoginMfaVerificationCapability } from "@bke/identity/logic/login-mfa-verification";
import { createIdentityMfaDisableCapability } from "@bke/identity/logic/mfa-disable";
import { createIdentityMfaEmergencyEnrollmentCapability } from "@bke/identity/logic/mfa-emergency-enrollment";
import { createIdentityMfaEnrollmentCompletionCapability } from "@bke/identity/logic/mfa-enrollment-completion";
import { createIdentityMfaEnrollmentStartCapability } from "@bke/identity/logic/mfa-enrollment-start";
import { createIdentityMfaRecoveryRegenerationCapability } from "@bke/identity/logic/mfa-recovery-regeneration";
import { createHmacEmailMfaChallengeMaterialProvider } from "@bke/identity/providers/hmac-email-mfa-challenge-material-provider";
import { createHmacEmailMfaProofProvider } from "@bke/identity/providers/hmac-email-mfa-proof-provider";
import { createHmacEmailVerificationTokenProvider } from "@bke/identity/providers/hmac-email-verification-token-provider";
import { createHmacMfaRecoveryCodeProvider } from "@bke/identity/providers/hmac-mfa-recovery-code-provider";
import { createHmacSessionTokenProvider } from "@bke/identity/providers/hmac-session-token-provider";
import { createIdentityRecentAuthChallengeIssuanceCapability } from "@bke/identity/logic/recent-auth-challenge-issuance";
import { createIdentityRecentAuthCompletionCapability } from "@bke/identity/logic/recent-auth-completion";
import { createIdentitySessionIssuanceCapability } from "@bke/identity/logic/session-issuance";
import { createIdentitySessionAdministrationCapability } from "@bke/identity/logic/session-administration";
import { createIdentitySessionTerminationCapability } from "@bke/identity/logic/session-termination";
import { createIdentitySessionValidationCapability } from "@bke/identity/logic/session-validation";
import { identityModuleManifest } from "@bke/identity/module.manifest";
import { createPostgresIdentityEmailVerificationCompletionRepository } from "@bke/identity/prisma/repositories/postgres-email-verification-completion-repository";
import { createPostgresIdentityEmailVerificationIssuanceRepository } from "@bke/identity/prisma/repositories/postgres-email-verification-issuance-repository";
import { createPostgresIdentityLoginMfaChallengeRepository } from "@bke/identity/prisma/repositories/postgres-login-mfa-challenge-repository";
import { createPostgresIdentityLoginMfaRepository } from "@bke/identity/prisma/repositories/postgres-login-mfa-repository";
import { createPostgresIdentityMfaDisableRepository } from "@bke/identity/prisma/repositories/postgres-mfa-disable-repository";
import { createPostgresIdentityMfaEmergencyEnrollmentRepository } from "@bke/identity/prisma/repositories/postgres-mfa-emergency-enrollment-repository";
import { createPostgresIdentityMfaEnrollmentCompletionRepository } from "@bke/identity/prisma/repositories/postgres-mfa-enrollment-completion-repository";
import { createPostgresIdentityMfaEnrollmentStartRepository } from "@bke/identity/prisma/repositories/postgres-mfa-enrollment-start-repository";
import { createPostgresIdentityMfaRecoveryRegenerationRepository } from "@bke/identity/prisma/repositories/postgres-mfa-recovery-regeneration-repository";
import { createPostgresIdentityRecentAuthChallengeRepository } from "@bke/identity/prisma/repositories/postgres-recent-auth-challenge-repository";
import { createPostgresIdentityRecentAuthCompletionRepository } from "@bke/identity/prisma/repositories/postgres-recent-auth-completion-repository";
import { createPostgresIdentityRepository } from "@bke/identity/prisma/repositories/postgres-identity-repository";
import { createPostgresIdentitySessionRepository } from "@bke/identity/prisma/repositories/postgres-session-repository";
import { createPostgresIdentitySessionAdministrationRepository } from "@bke/identity/prisma/repositories/postgres-session-administration-repository";
import { createPostgresIdentitySessionTerminationRepository } from "@bke/identity/prisma/repositories/postgres-session-termination-repository";

export interface IdentityModuleOptions {
  readonly connectionString: string;
  readonly sessionSecret: string;
  readonly mfaEncryptionKey?: string;
}

export function createIdentityModule(
  options: IdentityModuleOptions,
): CapabilityModule {
  const repository = createPostgresIdentityRepository(options.connectionString);
  const googleIdentityRepository = createPostgresIdentityGoogleIdentityRepository(options.connectionString);
  const googlePrincipalBinding = createIdentityGooglePrincipalBindingCapability(googleIdentityRepository);
  const googleAuthentication = createIdentityGoogleAuthenticationCapability(googleIdentityRepository);
  const retiredPasswordVerifier = {
    async verify(_hash: string, _password: string): Promise<boolean> {
      return false;
    },
  };
  const sessionRepository = createPostgresIdentitySessionRepository(
    options.connectionString,
  );
  const sessionTerminationRepository =
    createPostgresIdentitySessionTerminationRepository(options.connectionString);
  const sessionAdministrationRepository =
    createPostgresIdentitySessionAdministrationRepository(options.connectionString);
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
  const sessionTokenProvider = createHmacSessionTokenProvider(options.sessionSecret);
  const emailVerificationTokenProvider =
    createHmacEmailVerificationTokenProvider(options.sessionSecret);
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
  const sessionAdministration = createIdentitySessionAdministrationCapability(
    sessionAdministrationRepository,
  );
  const loginMfaChallengeIssuance = createIdentityLoginMfaChallengeIssuanceCapability(
    loginMfaChallengeRepository,
    emailMfaChallengeMaterialProvider,
  );
  const loginMfaChallengeReissue = createIdentityLoginMfaChallengeReissueCapability(
    loginMfaRepository,
    emailMfaProofProvider,
    loginMfaChallengeIssuance,
  );
  const retiredAuthenticationCapabilities = new Set([
    IDENTITY_PASSWORD_AUTHENTICATION_CAPABILITY_ID,
    IDENTITY_PASSWORD_CHANGE_CAPABILITY_ID,
    IDENTITY_PASSWORD_RESET_REQUEST_CAPABILITY_ID,
    IDENTITY_PASSWORD_RESET_COMPLETION_CAPABILITY_ID,
    IDENTITY_MAGIC_LOGIN_REQUEST_CAPABILITY_ID,
    IDENTITY_MAGIC_LOGIN_CONSUME_CAPABILITY_ID,
  ]);
  const hostManifest = Object.freeze({
    ...identityModuleManifest,
    provides: [
      ...identityModuleManifest.provides.filter(
        (capabilityId) => !retiredAuthenticationCapabilities.has(capabilityId),
      ),
      IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID,
      IDENTITY_LOGIN_MFA_CHALLENGE_REISSUE_CAPABILITY_ID,
    ],
  });

  return Object.freeze({
    manifest: hostManifest,
    start() {
      return [
        { id: IDENTITY_GOOGLE_AUTHENTICATION_CAPABILITY_ID, value: googleAuthentication },
        { id: IDENTITY_GOOGLE_PRINCIPAL_BINDING_CAPABILITY_ID, value: googlePrincipalBinding },
        {
          id: IDENTITY_LOOKUP_CAPABILITY_ID,
          value: createIdentityLookupCapability(repository),
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
          id: IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID,
          value: sessionAdministration,
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
          value: loginMfaChallengeIssuance,
        },
        {
          id: IDENTITY_LOGIN_MFA_CHALLENGE_REISSUE_CAPABILITY_ID,
          value: loginMfaChallengeReissue,
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
            undefined,
            sessionValidation,
          ),
        },
        {
          id: IDENTITY_RECENT_AUTH_COMPLETION_CAPABILITY_ID,
          value: createIdentityRecentAuthCompletionCapability(
            recentAuthCompletionRepository,
            sessionValidation,
            retiredPasswordVerifier,
            emailMfaProofProvider,
          ),
        },
      ];
    },
  });
}

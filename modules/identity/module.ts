import type { CapabilityModule } from "../../contracts/capability";
import { IDENTITY_LOOKUP_CAPABILITY_ID } from "@bke/identity/contracts/identity.contract";
import { IDENTITY_GOOGLE_AUTHENTICATION_CAPABILITY_ID } from "@bke/identity/contracts/google-authentication.contract";
import { IDENTITY_GOOGLE_PRINCIPAL_BINDING_CAPABILITY_ID } from "@bke/identity/contracts/google-identity.contract";
import { IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID } from "@bke/identity/contracts/session-administration.contract";
import { IDENTITY_SESSION_TERMINATION_CAPABILITY_ID } from "@bke/identity/contracts/session-termination.contract";
import { IDENTITY_SESSION_VALIDATION_CAPABILITY_ID } from "@bke/identity/contracts/session-validation.contract";
import { IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID } from "@bke/identity/contracts/session.contract";
import { createIdentityLookupCapability } from "@bke/identity/logic/identity-service";
import { createIdentityGoogleAuthenticationCapability } from "@bke/identity/logic/google-authentication";
import { createIdentityGooglePrincipalBindingCapability } from "@bke/identity/logic/google-identity";
import { createIdentitySessionIssuanceCapability } from "@bke/identity/logic/session-issuance";
import { createIdentitySessionAdministrationCapability } from "@bke/identity/logic/session-administration";
import { createIdentitySessionTerminationCapability } from "@bke/identity/logic/session-termination";
import { createIdentitySessionValidationCapability } from "@bke/identity/logic/session-validation";
import { createHmacSessionTokenProvider } from "@bke/identity/providers/hmac-session-token-provider";
import { identityModuleManifest } from "@bke/identity/module.manifest";
import { createPostgresIdentityGoogleIdentityRepository } from "@bke/identity/prisma/repositories/postgres-google-identity-repository";
import { createPostgresIdentityRepository } from "@bke/identity/prisma/repositories/postgres-identity-repository";
import { createPostgresIdentitySessionRepository } from "@bke/identity/prisma/repositories/postgres-session-repository";
import { createPostgresIdentitySessionAdministrationRepository } from "@bke/identity/prisma/repositories/postgres-session-administration-repository";
import { createPostgresIdentitySessionTerminationRepository } from "@bke/identity/prisma/repositories/postgres-session-termination-repository";

export interface IdentityModuleOptions {
  readonly connectionString: string;
  readonly sessionSecret: string;
}

export function createIdentityModule(options: IdentityModuleOptions): CapabilityModule {
  const googleRepository = createPostgresIdentityGoogleIdentityRepository(options.connectionString);
  const googleAuthentication = createIdentityGoogleAuthenticationCapability(googleRepository);
  const sessionRepository = createPostgresIdentitySessionRepository(options.connectionString);
  const tokenProvider = createHmacSessionTokenProvider(options.sessionSecret);
  // This consumer's policy is Google primary authentication without BKE MFA.
  // Other applications keep the unchanged shared package's authentication policy.
  const googleOnlyAuthentication = {
    async authenticate(input: Readonly<{ subject: string }>) {
      const result = await googleAuthentication.authenticate(input);
      return result.status === "PRIMARY_AUTHENTICATED"
        ? { ...result, route: "SESSION" as const }
        : result;
    },
  };
  const capabilities = [
    { id: IDENTITY_GOOGLE_AUTHENTICATION_CAPABILITY_ID, value: googleOnlyAuthentication },
    { id: IDENTITY_GOOGLE_PRINCIPAL_BINDING_CAPABILITY_ID,
      value: createIdentityGooglePrincipalBindingCapability(googleRepository) },
    { id: IDENTITY_LOOKUP_CAPABILITY_ID,
      value: createIdentityLookupCapability(createPostgresIdentityRepository(options.connectionString)) },
    { id: IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID,
      value: createIdentitySessionIssuanceCapability(sessionRepository, tokenProvider) },
    { id: IDENTITY_SESSION_VALIDATION_CAPABILITY_ID,
      value: createIdentitySessionValidationCapability(sessionRepository, tokenProvider) },
    { id: IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID,
      value: createIdentitySessionAdministrationCapability(
        createPostgresIdentitySessionAdministrationRepository(options.connectionString)) },
    { id: IDENTITY_SESSION_TERMINATION_CAPABILITY_ID,
      value: createIdentitySessionTerminationCapability(
        createPostgresIdentitySessionTerminationRepository(options.connectionString), tokenProvider) },
  ];
  return Object.freeze({
    manifest: Object.freeze({ ...identityModuleManifest, provides: capabilities.map(({ id }) => id) }),
    start() { return capabilities; },
  });
}

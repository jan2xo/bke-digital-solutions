import type { CapabilityModule } from "../../contracts/capability";
import {
  IDENTITY_LOOKUP_CAPABILITY_ID,
  IDENTITY_PASSWORD_AUTHENTICATION_CAPABILITY_ID,
} from "./contracts/identity.contract";
import { IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID } from "./contracts/session.contract";
import { createIdentityLookupCapability } from "./logic/identity-service";
import { createIdentityPasswordAuthenticationCapability } from "./logic/password-authentication";
import { createArgon2PasswordVerifier } from "./logic/providers/argon2-password-verifier";
import { createHmacSessionTokenProvider } from "./logic/providers/hmac-session-token-provider";
import { createIdentitySessionIssuanceCapability } from "./logic/session-issuance";
import { identityModuleManifest } from "./module.manifest";
import { createPostgresIdentityRepository } from "./prisma/repositories/postgres-identity-repository";
import { createPostgresIdentitySessionRepository } from "./prisma/repositories/postgres-session-repository";

export interface IdentityModuleOptions {
  readonly connectionString: string;
  readonly sessionSecret: string;
}

export function createIdentityModule(
  options: IdentityModuleOptions,
): CapabilityModule {
  const repository = createPostgresIdentityRepository(options.connectionString);
  const passwordVerifier = createArgon2PasswordVerifier();
  const sessionRepository = createPostgresIdentitySessionRepository(
    options.connectionString,
  );
  const sessionTokenProvider = createHmacSessionTokenProvider(options.sessionSecret);

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
      ];
    },
  });
}

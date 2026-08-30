import type { CapabilityModule } from "../../contracts/capability";
import {
  IDENTITY_LOOKUP_CAPABILITY_ID,
  IDENTITY_PASSWORD_AUTHENTICATION_CAPABILITY_ID,
} from "./contracts/identity.contract";
import { createIdentityLookupCapability } from "./logic/identity-service";
import { createIdentityPasswordAuthenticationCapability } from "./logic/password-authentication";
import { createArgon2PasswordVerifier } from "./logic/providers/argon2-password-verifier";
import { identityModuleManifest } from "./module.manifest";
import { createPostgresIdentityRepository } from "./prisma/repositories/postgres-identity-repository";

export interface IdentityModuleOptions {
  readonly connectionString: string;
}

export function createIdentityModule(
  options: IdentityModuleOptions,
): CapabilityModule {
  const repository = createPostgresIdentityRepository(options.connectionString);
  const passwordVerifier = createArgon2PasswordVerifier();

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
      ];
    },
  });
}

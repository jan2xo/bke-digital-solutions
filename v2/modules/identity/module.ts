import type { CapabilityModule } from "../../contracts/capability";
import { IDENTITY_LOOKUP_CAPABILITY_ID } from "./contracts/identity.contract";
import { createIdentityLookupCapability } from "./logic/identity-service";
import { identityModuleManifest } from "./module.manifest";
import { createPostgresIdentityRepository } from "./prisma/repositories/postgres-identity-repository";

export interface IdentityModuleOptions {
  readonly connectionString: string;
}

export function createIdentityModule(
  options: IdentityModuleOptions,
): CapabilityModule {
  const repository = createPostgresIdentityRepository(options.connectionString);

  return Object.freeze({
    manifest: identityModuleManifest,
    start() {
      return [
        {
          id: IDENTITY_LOOKUP_CAPABILITY_ID,
          value: createIdentityLookupCapability(repository),
        },
      ];
    },
  });
}

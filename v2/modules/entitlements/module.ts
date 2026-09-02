import type { CapabilityModule } from "../../contracts/capability";
import { ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID } from "./contracts/durable-right-grant.contract";
import { createEntitlementsDurableRightGrantCapability } from "./logic/durable-right-grant";
import { entitlementsModuleManifest } from "./module.manifest";
import { createPostgresEntitlementsDurableRightGrantRepository } from "./prisma/repositories/postgres-durable-right-grant-repository";

export interface EntitlementsModuleOptions {
  readonly connectionString: string;
}

export function createEntitlementsModule(options: EntitlementsModuleOptions): CapabilityModule {
  const durableRightGrant = createEntitlementsDurableRightGrantCapability(
    createPostgresEntitlementsDurableRightGrantRepository(options.connectionString),
  );

  return Object.freeze({
    manifest: entitlementsModuleManifest,
    start() {
      return [
        {
          id: ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID,
          value: durableRightGrant,
        },
      ];
    },
  });
}

import type { CapabilityModule } from "../../contracts/capability";
import { ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID } from "@bke/entitlements/contracts/durable-right-grant.contract";
import { createEntitlementsDurableRightGrantCapability } from "@bke/entitlements/logic/durable-right-grant";
import { entitlementsModuleManifest } from "@bke/entitlements/module.manifest";
import { createPostgresEntitlementsDurableRightGrantRepository } from "@bke/entitlements/prisma/repositories/postgres-durable-right-grant-repository";

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

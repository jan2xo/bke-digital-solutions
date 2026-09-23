import type { CapabilityModule } from "../../contracts/capability";
import { ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID } from "@bke/entitlements/contracts/durable-right-grant.contract";
import { ENTITLEMENTS_DURABLE_RIGHT_REVOCATION_CAPABILITY_ID } from "@bke/entitlements/contracts/durable-right-revocation.contract";
import { createEntitlementsDurableRightGrantCapability } from "@bke/entitlements/logic/durable-right-grant";
import { createEntitlementsDurableRightRevocationCapability } from "@bke/entitlements/logic/durable-right-revocation";
import { entitlementsModuleManifest } from "@bke/entitlements/module.manifest";
import { createPostgresEntitlementsDurableRightGrantRepository } from "@bke/entitlements/prisma/repositories/postgres-durable-right-grant-repository";
import { createPostgresEntitlementsDurableRightRevocationRepository } from "@bke/entitlements/prisma/repositories/postgres-durable-right-revocation-repository";

export interface EntitlementsModuleOptions {
  readonly connectionString: string;
}

export function createEntitlementsModule(options: EntitlementsModuleOptions): CapabilityModule {
  const durableRightGrant = createEntitlementsDurableRightGrantCapability(
    createPostgresEntitlementsDurableRightGrantRepository(options.connectionString),
  );
  const durableRightRevocation = createEntitlementsDurableRightRevocationCapability(
    createPostgresEntitlementsDurableRightRevocationRepository(options.connectionString),
  );

  return Object.freeze({
    manifest: entitlementsModuleManifest,
    start() {
      return [
        {
          id: ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID,
          value: durableRightGrant,
        },
        {
          id: ENTITLEMENTS_DURABLE_RIGHT_REVOCATION_CAPABILITY_ID,
          value: durableRightRevocation,
        },
      ];
    },
  });
}

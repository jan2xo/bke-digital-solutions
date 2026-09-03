import {
  CATALOG_LOOKUP_CAPABILITY_ID,
  CATALOG_MANAGEMENT_CAPABILITY_ID,
} from "@bke/catalog/contracts/catalog.contract";
import {
  createCatalogLookupCapability,
  createCatalogManagementCapability,
} from "@bke/catalog/logic/catalog";
import { catalogModuleManifest } from "@bke/catalog/module.manifest";
import { createPostgresCatalogRepository } from "@bke/catalog/prisma/repositories/postgres-catalog-repository";
import type { CapabilityModule } from "../../contracts/capability";

export interface CatalogModuleOptions {
  readonly connectionString: string;
}

export function createCatalogModule(options: CatalogModuleOptions): CapabilityModule {
  const repository = createPostgresCatalogRepository(options.connectionString);
  return Object.freeze({
    manifest: catalogModuleManifest,
    start() {
      return [
        {
          id: CATALOG_LOOKUP_CAPABILITY_ID,
          value: createCatalogLookupCapability(repository),
        },
        {
          id: CATALOG_MANAGEMENT_CAPABILITY_ID,
          value: createCatalogManagementCapability(repository),
        },
      ];
    },
  });
}

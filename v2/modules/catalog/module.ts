import type { CapabilityModule } from "../../contracts/capability";
import {
  CATALOG_LOOKUP_CAPABILITY_ID,
  CATALOG_MANAGEMENT_CAPABILITY_ID,
} from "./contracts/catalog.contract";
import {
  createCatalogLookupCapability,
  createCatalogManagementCapability,
} from "./logic/catalog";
import { catalogModuleManifest } from "./module.manifest";
import { createPostgresCatalogRepository } from "./prisma/repositories/postgres-catalog-repository";

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

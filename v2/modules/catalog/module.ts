import {
  CATALOG_LICENSING_VERSION_FACTS_CAPABILITY_ID,
  CATALOG_LOOKUP_CAPABILITY_ID,
  CATALOG_MANAGEMENT_CAPABILITY_ID,
} from "@bke/catalog/contracts/catalog.contract";
import {
  createCatalogLookupCapability,
  createCatalogManagementCapability,
} from "@bke/catalog/logic/catalog";
import { createCatalogLicensingVersionFactsCapability } from "@bke/catalog/logic/licensing-version-facts";
import { catalogModuleManifest } from "@bke/catalog/module.manifest";
import { createLegacySchemaCatalogLicensingVersionFactsRepository } from "@bke/catalog/prisma/repositories/legacy-schema-licensing-version-facts-repository";
import { createPostgresCatalogRepository } from "@bke/catalog/prisma/repositories/postgres-catalog-repository";
import { createPostgresCatalogLicensingVersionFactsRepository } from "@bke/catalog/prisma/repositories/postgres-licensing-version-facts-repository";
import type { CapabilityModule } from "../../contracts/capability";

export interface CatalogModuleOptions {
  readonly connectionString: string;
  readonly licensingVersionFactsStorage?: "native" | "legacy-product-schema";
}

export function createCatalogModule(options: CatalogModuleOptions): CapabilityModule {
  const repository = createPostgresCatalogRepository(options.connectionString);
  const licensingVersionFactsRepository =
    options.licensingVersionFactsStorage === "legacy-product-schema"
      ? createLegacySchemaCatalogLicensingVersionFactsRepository(options.connectionString)
      : createPostgresCatalogLicensingVersionFactsRepository(options.connectionString);
  const licensingVersionFacts = createCatalogLicensingVersionFactsCapability(
    licensingVersionFactsRepository,
  );
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
        {
          id: CATALOG_LICENSING_VERSION_FACTS_CAPABILITY_ID,
          value: licensingVersionFacts,
        },
      ];
    },
  });
}

import type { CapabilityModule } from "../../contracts/capability";
import { LEGAL_ACCEPTANCE_CAPABILITY_ID } from "./contracts/acceptance.contract";
import { createLegalAcceptanceCapability } from "./logic/acceptance";
import { legalModuleManifest } from "./module.manifest";
import { createPostgresLegalAcceptanceRepository } from "./prisma/repositories/postgres-acceptance-repository";

export interface LegalModuleOptions {
  readonly connectionString: string;
}

export function createLegalModule(options: LegalModuleOptions): CapabilityModule {
  const acceptance = createLegalAcceptanceCapability(
    createPostgresLegalAcceptanceRepository(options.connectionString),
  );

  return Object.freeze({
    manifest: legalModuleManifest,
    start() {
      return [{ id: LEGAL_ACCEPTANCE_CAPABILITY_ID, value: acceptance }];
    },
  });
}

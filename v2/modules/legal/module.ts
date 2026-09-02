import type { CapabilityModule } from "../../contracts/capability";
import { LEGAL_ACCEPTANCE_CAPABILITY_ID } from "@bke/legal/contracts/acceptance.contract";
import { createLegalAcceptanceCapability } from "@bke/legal/logic/acceptance";
import { legalModuleManifest } from "@bke/legal/module.manifest";
import { createPostgresLegalAcceptanceRepository } from "@bke/legal/prisma/repositories/postgres-acceptance-repository";

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

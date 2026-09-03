import type { CapabilityModule } from "../../contracts/capability";
import { LEGAL_ACCEPTANCE_CAPABILITY_ID } from "@bke/legal/contracts/acceptance.contract";
import { LEGAL_CHECKOUT_REQUIREMENTS_CAPABILITY_ID } from "@bke/legal/contracts/checkout-requirements.contract";
import { createLegalAcceptanceCapability } from "@bke/legal/logic/acceptance";
import { createLegalCheckoutRequirementsCapability } from "@bke/legal/logic/checkout-requirements";
import { legalModuleManifest } from "@bke/legal/module.manifest";
import { createPostgresLegalAcceptanceRepository } from "@bke/legal/prisma/repositories/postgres-acceptance-repository";
import { createPostgresLegalCheckoutRequirementsRepository } from "@bke/legal/prisma/repositories/postgres-checkout-requirements-repository";

export interface LegalModuleOptions {
  readonly connectionString: string;
}

export function createLegalModule(options: LegalModuleOptions): CapabilityModule {
  const acceptance = createLegalAcceptanceCapability(
    createPostgresLegalAcceptanceRepository(options.connectionString),
  );
  const checkoutRequirements = createLegalCheckoutRequirementsCapability(
    createPostgresLegalCheckoutRequirementsRepository(options.connectionString),
  );

  return Object.freeze({
    manifest: legalModuleManifest,
    start() {
      return [
        { id: LEGAL_ACCEPTANCE_CAPABILITY_ID, value: acceptance },
        {
          id: LEGAL_CHECKOUT_REQUIREMENTS_CAPABILITY_ID,
          value: checkoutRequirements,
        },
      ];
    },
  });
}

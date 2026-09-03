import type { CapabilityModule } from "../../contracts/capability";
import { LEGAL_ACCEPTANCE_CAPABILITY_ID } from "@bke/legal/contracts/acceptance.contract";
import { LEGAL_CHECKOUT_REQUIREMENTS_CAPABILITY_ID } from "@bke/legal/contracts/checkout-requirements.contract";
import { LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID } from "@bke/legal/contracts/reacceptance-status.contract";
import { createLegalAcceptanceCapability } from "@bke/legal/logic/acceptance";
import { createLegalCheckoutRequirementsCapability } from "@bke/legal/logic/checkout-requirements";
import { createLegalReacceptanceStatusCapability } from "@bke/legal/logic/reacceptance-status";
import { legalModuleManifest } from "@bke/legal/module.manifest";
import { createPostgresLegalAcceptanceRepository } from "@bke/legal/prisma/repositories/postgres-acceptance-repository";
import { createPostgresLegalCheckoutRequirementsRepository } from "@bke/legal/prisma/repositories/postgres-checkout-requirements-repository";
import { createPostgresLegalReacceptanceStatusRepository } from "@bke/legal/prisma/repositories/postgres-reacceptance-status-repository";

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
  const reacceptanceStatus = createLegalReacceptanceStatusCapability(
    createPostgresLegalReacceptanceStatusRepository(options.connectionString),
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
        {
          id: LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID,
          value: reacceptanceStatus,
        },
      ];
    },
  });
}

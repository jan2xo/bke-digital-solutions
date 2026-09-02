import type { CapabilityModule } from "../../contracts/capability";
import { PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID } from "./contracts/checkout-attempt.contract";
import { PAYMENTS_PROVIDER_EVENT_INGESTION_CAPABILITY_ID } from "./contracts/provider-event-ingestion.contract";
import { PAYMENTS_SETTLEMENT_FACT_CAPABILITY_ID } from "./contracts/settlement-fact.contract";
import { createPaymentsCheckoutAttemptCapability } from "./logic/checkout-attempt";
import type { PaymentsCheckoutProvider } from "./logic/checkout-attempt-provider";
import { createPaymentsProviderEventIngestionCapability } from "./logic/provider-event-ingestion";
import type { PaymentsProviderEventVerifier } from "./logic/provider-event-verifier";
import { createPaymentsSettlementFactCapability } from "./logic/settlement-fact";
import { paymentsModuleManifest } from "./module.manifest";
import { createPostgresPaymentsCheckoutAttemptRepository } from "./prisma/repositories/postgres-checkout-attempt-repository";
import { createPostgresPaymentsProviderEventRepository } from "./prisma/repositories/postgres-provider-event-repository";
import { createPostgresPaymentsSettlementFactRepository } from "./prisma/repositories/postgres-settlement-fact-repository";

export interface PaymentsModuleOptions {
  readonly connectionString: string;
  readonly provider: PaymentsCheckoutProvider;
  readonly eventVerifier: PaymentsProviderEventVerifier;
}

export function createPaymentsModule(options: PaymentsModuleOptions): CapabilityModule {
  const providerName = options.provider.name.trim().toLowerCase();
  const verifierName = options.eventVerifier.name.trim().toLowerCase();
  if (!providerName || providerName !== verifierName) {
    throw new Error("PAYMENTS_PROVIDER_VERIFIER_MISMATCH");
  }

  const checkoutAttempt = createPaymentsCheckoutAttemptCapability(
    createPostgresPaymentsCheckoutAttemptRepository(options.connectionString),
    options.provider,
  );
  const providerEventIngestion = createPaymentsProviderEventIngestionCapability(
    createPostgresPaymentsProviderEventRepository(options.connectionString),
    options.eventVerifier,
  );
  const settlementFact = createPaymentsSettlementFactCapability(
    createPostgresPaymentsSettlementFactRepository(options.connectionString),
  );

  return Object.freeze({
    manifest: paymentsModuleManifest,
    start() {
      return [
        { id: PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID, value: checkoutAttempt },
        { id: PAYMENTS_PROVIDER_EVENT_INGESTION_CAPABILITY_ID, value: providerEventIngestion },
        { id: PAYMENTS_SETTLEMENT_FACT_CAPABILITY_ID, value: settlementFact },
      ];
    },
  });
}

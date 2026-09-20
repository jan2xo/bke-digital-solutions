import type { CapabilityModule } from "../../contracts/capability";
import { PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID } from "@bke/payments/contracts/checkout-attempt.contract";
import { PAYMENTS_PROVIDER_EVENT_INGESTION_CAPABILITY_ID } from "@bke/payments/contracts/provider-event-ingestion.contract";
import { PAYMENTS_RECONCILIATION_CAPABILITY_ID } from "@bke/payments/contracts/reconciliation.contract";
import { PAYMENTS_REFUND_INITIATION_CAPABILITY_ID } from "@bke/payments/contracts/refund-initiation.contract";
import { PAYMENTS_SETTLEMENT_FACT_CAPABILITY_ID } from "@bke/payments/contracts/settlement-fact.contract";
import { createPaymentsCheckoutAttemptCapability } from "@bke/payments/logic/checkout-attempt";
import type { PaymentsCheckoutProvider } from "@bke/payments/logic/checkout-attempt-provider";
import { createPaymentsProviderEventIngestionCapability } from "@bke/payments/logic/provider-event-ingestion";
import type { PaymentsProviderEventVerifier } from "@bke/payments/logic/provider-event-verifier";
import { createPaymentsReconciliationCapability } from "@bke/payments/logic/reconciliation";
import type { PaymentsReconciliationProvider } from "@bke/payments/logic/reconciliation-provider";
import { createPaymentsRefundInitiationCapability } from "@bke/payments/logic/refund-initiation";
import type { PaymentsRefundProvider } from "@bke/payments/logic/refund-provider";
import { createPaymentsSettlementFactCapability } from "@bke/payments/logic/settlement-fact";
import { paymentsModuleManifest } from "@bke/payments/module.manifest";
import { createPostgresPaymentsCheckoutAttemptRepository } from "@bke/payments/prisma/repositories/postgres-checkout-attempt-repository";
import { createPostgresPaymentsProviderEventRepository } from "@bke/payments/prisma/repositories/postgres-provider-event-repository";
import { createPostgresPaymentsReconciliationRepository } from "@bke/payments/prisma/repositories/postgres-reconciliation-repository";
import { createPostgresPaymentsRefundRepository } from "@bke/payments/prisma/repositories/postgres-refund-repository";
import { createPostgresPaymentsSettlementFactRepository } from "@bke/payments/prisma/repositories/postgres-settlement-fact-repository";

export interface PaymentsModuleOptions {
  readonly connectionString: string;
  readonly provider: PaymentsCheckoutProvider;
  readonly eventVerifier: PaymentsProviderEventVerifier;
  readonly refundProvider: PaymentsRefundProvider;
  readonly reconciliationProvider: PaymentsReconciliationProvider;
}

export function createPaymentsModule(options: PaymentsModuleOptions): CapabilityModule {
  const providerName = options.provider.name.trim().toLowerCase();
  const verifierName = options.eventVerifier.name.trim().toLowerCase();
  const refundProviderName = options.refundProvider.name.trim().toLowerCase();
  const reconciliationProviderName = options.reconciliationProvider.name.trim().toLowerCase();
  if (
    !providerName ||
    providerName !== verifierName ||
    providerName !== refundProviderName ||
    providerName !== reconciliationProviderName
  ) {
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
  const refundInitiation = createPaymentsRefundInitiationCapability(
    createPostgresPaymentsRefundRepository(options.connectionString),
    options.refundProvider,
  );
  const reconciliation = createPaymentsReconciliationCapability(
    createPostgresPaymentsReconciliationRepository(options.connectionString),
    options.reconciliationProvider,
  );

  return Object.freeze({
    manifest: paymentsModuleManifest,
    start() {
      return [
        { id: PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID, value: checkoutAttempt },
        { id: PAYMENTS_PROVIDER_EVENT_INGESTION_CAPABILITY_ID, value: providerEventIngestion },
        { id: PAYMENTS_SETTLEMENT_FACT_CAPABILITY_ID, value: settlementFact },
        { id: PAYMENTS_REFUND_INITIATION_CAPABILITY_ID, value: refundInitiation },
        { id: PAYMENTS_RECONCILIATION_CAPABILITY_ID, value: reconciliation },
      ];
    },
  });
}

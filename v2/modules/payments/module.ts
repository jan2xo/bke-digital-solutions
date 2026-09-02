import type { CapabilityModule } from "../../contracts/capability";
import { PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID } from "./contracts/checkout-attempt.contract";
import { createPaymentsCheckoutAttemptCapability } from "./logic/checkout-attempt";
import type { PaymentsCheckoutProvider } from "./logic/checkout-attempt-provider";
import { paymentsModuleManifest } from "./module.manifest";
import { createPostgresPaymentsCheckoutAttemptRepository } from "./prisma/repositories/postgres-checkout-attempt-repository";

export interface PaymentsModuleOptions {
  readonly connectionString: string;
  readonly provider: PaymentsCheckoutProvider;
}

export function createPaymentsModule(options: PaymentsModuleOptions): CapabilityModule {
  const checkoutAttempt = createPaymentsCheckoutAttemptCapability(
    createPostgresPaymentsCheckoutAttemptRepository(options.connectionString),
    options.provider,
  );

  return Object.freeze({
    manifest: paymentsModuleManifest,
    start() {
      return [
        {
          id: PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID,
          value: checkoutAttempt,
        },
      ];
    },
  });
}

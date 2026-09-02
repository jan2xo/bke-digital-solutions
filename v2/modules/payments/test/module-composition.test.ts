import { describe, expect, it } from "vitest";
import { composeCapabilities } from "../../../platform/composition/composer";
import {
  PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID,
  type PaymentsCheckoutAttemptCapability,
} from "../contracts/checkout-attempt.contract";
import {
  PAYMENTS_PROVIDER_EVENT_INGESTION_CAPABILITY_ID,
  type PaymentsProviderEventIngestionCapability,
} from "../contracts/provider-event-ingestion.contract";
import {
  PAYMENTS_SETTLEMENT_FACT_CAPABILITY_ID,
  type PaymentsSettlementFactCapability,
} from "../contracts/settlement-fact.contract";
import type { PaymentsCheckoutProvider } from "../logic/checkout-attempt-provider";
import type { PaymentsProviderEventVerifier } from "../logic/provider-event-verifier";
import { createPaymentsModule } from "../module";

const provider: PaymentsCheckoutProvider = {
  name: "composition-provider",
  async createCheckout() { throw new Error("composition startup must not invoke provider"); },
};
const eventVerifier: PaymentsProviderEventVerifier = {
  name: "composition-provider",
  async verifyAndParse() { throw new Error("composition startup must not invoke event verifier"); },
};

describe("Payments module composition", () => {
  it("registers all certified Payments capabilities without touching dependencies at startup", async () => {
    const application = await composeCapabilities([
      createPaymentsModule({ connectionString: "postgresql://unused.invalid/payments", provider, eventVerifier }),
    ]);
    expect(application.moduleIds).toContain("payments");
    expect(application.has(PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID)).toBe(true);
    expect(application.has(PAYMENTS_PROVIDER_EVENT_INGESTION_CAPABILITY_ID)).toBe(true);
    expect(application.has(PAYMENTS_SETTLEMENT_FACT_CAPABILITY_ID)).toBe(true);
    expect(typeof application.get<PaymentsCheckoutAttemptCapability>(PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID).create).toBe("function");
    expect(typeof application.get<PaymentsProviderEventIngestionCapability>(PAYMENTS_PROVIDER_EVENT_INGESTION_CAPABILITY_ID).ingest).toBe("function");
    expect(typeof application.get<PaymentsSettlementFactCapability>(PAYMENTS_SETTLEMENT_FACT_CAPABILITY_ID).reconcile).toBe("function");
  });
});

import { describe, expect, it } from "vitest";
import { composeCapabilities } from "../../../platform/composition/composer";
import {
  PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID,
  type PaymentsCheckoutAttemptCapability,
} from "../contracts/checkout-attempt.contract";
import type { PaymentsCheckoutProvider } from "../logic/checkout-attempt-provider";
import { createPaymentsModule } from "../module";

const provider: PaymentsCheckoutProvider = {
  name: "composition-provider",
  async createCheckout() {
    throw new Error("composition startup must not invoke provider");
  },
};

describe("Payments module composition", () => {
  it("registers the checkout-attempt capability without touching persistence or provider at startup", async () => {
    const application = await composeCapabilities([
      createPaymentsModule({
        connectionString: "postgresql://unused.invalid/payments",
        provider,
      }),
    ]);

    expect(application.moduleIds).toContain("payments");
    expect(application.has(PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID)).toBe(true);
    expect(
      typeof application.get<PaymentsCheckoutAttemptCapability>(
        PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID,
      ).create,
    ).toBe("function");
  });
});

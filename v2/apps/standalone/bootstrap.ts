import type { PaymentsCheckoutProvider } from "@bke/payments/logic/checkout-attempt-provider";
import type { PaymentsProviderEventVerifier } from "@bke/payments/logic/provider-event-verifier";
import type { PaymentsRefundProvider } from "@bke/payments/logic/refund-provider";
import { createAccountsModule } from "../../modules/accounts/module";
import { createCommerceModule } from "../../modules/commerce/module";
import { createEntitlementsModule } from "../../modules/entitlements/module";
import { createIdentityModule } from "../../modules/identity/module";
import { createLegalModule } from "../../modules/legal/module";
import { createLicensingModule } from "../../modules/licensing/module";
import { createPaymentsModule } from "../../modules/payments/module";
import { composeCapabilities } from "../../platform/composition/composer";

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing standalone V2 environment: ${name}`);
  return value;
}

const connectionString = requireEnvironment("DATABASE_URL");
const sessionSecret = requireEnvironment("V2_STANDALONE_SESSION_SECRET");
const licensePepper = requireEnvironment("V2_STANDALONE_LICENSE_PEPPER");

const inertCheckoutProvider: PaymentsCheckoutProvider = {
  name: "standalone-certification",
  async createCheckout() {
    throw new Error("Standalone composition boot must not invoke payment checkout.");
  },
};

const inertEventVerifier: PaymentsProviderEventVerifier = {
  name: "standalone-certification",
  async verifyAndParse() {
    throw new Error("Standalone composition boot must not verify provider events.");
  },
};

const inertRefundProvider: PaymentsRefundProvider = {
  name: "standalone-certification",
  async createRefund() {
    throw new Error("Standalone composition boot must not invoke refunds.");
  },
};

const application = await composeCapabilities([
  createIdentityModule({ connectionString, sessionSecret }),
  createAccountsModule({ connectionString }),
  createLegalModule({ connectionString }),
  createCommerceModule({ connectionString }),
  createPaymentsModule({
    connectionString,
    provider: inertCheckoutProvider,
    eventVerifier: inertEventVerifier,
    refundProvider: inertRefundProvider,
  }),
  createEntitlementsModule({ connectionString }),
  createLicensingModule({ connectionString, licensePepper }),
]);

const expectedModules = [
  "identity",
  "accounts",
  "legal",
  "commerce",
  "payments",
  "entitlements",
  "licensing",
] as const;

for (const moduleId of expectedModules) {
  if (!application.moduleIds.includes(moduleId)) {
    throw new Error(`Standalone V2 composition is missing module: ${moduleId}`);
  }
}

console.log(
  `V2 standalone capability host GREEN: modules=${application.moduleIds.join(",")} capabilities=${application.capabilityIds.length}`,
);

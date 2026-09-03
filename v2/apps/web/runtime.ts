import "server-only";
import type { ComposedApplication } from "../../contracts/capability";
import { createAccountsModule } from "../../modules/accounts/module";
import { createCatalogModule } from "../../modules/catalog/module";
import { createCommerceModule } from "../../modules/commerce/module";
import { createEntitlementsModule } from "../../modules/entitlements/module";
import { createIdentityModule } from "../../modules/identity/module";
import { createLegalModule } from "../../modules/legal/module";
import { createLicensingModule } from "../../modules/licensing/module";
import { notificationsModule } from "../../modules/notifications/module";
import { createPaymentsModule } from "../../modules/payments/module";
import { composeCapabilities } from "../../platform/composition/composer";
import { createWebPaymentsAdapter } from "./payments/provider";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing V2 web runtime environment: ${name}`);
  return value;
}

async function composeWebApplication(): Promise<ComposedApplication> {
  const connectionString = required("DATABASE_URL");
  const sessionSecret = required("SESSION_SECRET");
  const licensePepper = required("LICENSE_PEPPER");
  const mfaEncryptionKey = process.env.MFA_ENCRYPTION_KEY?.trim() || undefined;
  const payments = createWebPaymentsAdapter();

  return composeCapabilities([
    createIdentityModule({ connectionString, sessionSecret, mfaEncryptionKey }),
    createAccountsModule({ connectionString }),
    createLegalModule({ connectionString }),
    createCatalogModule({ connectionString }),
    createCommerceModule({ connectionString }),
    createPaymentsModule({
      connectionString,
      provider: payments,
      eventVerifier: payments,
      refundProvider: payments,
    }),
    createEntitlementsModule({ connectionString }),
    createLicensingModule({ connectionString, licensePepper }),
    notificationsModule,
  ]);
}

const globalRuntime = globalThis as unknown as { bkeV2WebApplication?: Promise<ComposedApplication> };

export function getV2WebApplication(): Promise<ComposedApplication> {
  if (!globalRuntime.bkeV2WebApplication) {
    globalRuntime.bkeV2WebApplication = composeWebApplication().catch((error) => {
      delete globalRuntime.bkeV2WebApplication;
      throw error;
    });
  }
  return globalRuntime.bkeV2WebApplication;
}

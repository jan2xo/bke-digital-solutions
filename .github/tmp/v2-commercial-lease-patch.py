from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"expected source block missing in {path}: {old[:100]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"expected source block is not unique in {path}")
    p.write_text(text.replace(old, new, 1))

# Accounts: adopt the released account-lifecycle fact capability.
replace_once(
    "v2/modules/accounts/module.ts",
    'import { ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID } from "@bke/accounts/contracts/account-access.contract";\n',
    'import { ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID } from "@bke/accounts/contracts/account-access.contract";\n'
    'import { ACCOUNTS_ACCOUNT_LIFECYCLE_CAPABILITY_ID } from "@bke/accounts/contracts/account-lifecycle.contract";\n',
)
replace_once(
    "v2/modules/accounts/module.ts",
    'import { createAccountsAccountAccessCapability } from "@bke/accounts/logic/account-access";\n',
    'import { createAccountsAccountAccessCapability } from "@bke/accounts/logic/account-access";\n'
    'import { createAccountsAccountLifecycleCapability } from "@bke/accounts/logic/account-lifecycle";\n',
)
replace_once(
    "v2/modules/accounts/module.ts",
    'import { createPostgresAccountsAccountAccessRepository } from "@bke/accounts/prisma/repositories/postgres-account-access-repository";\n',
    'import { createPostgresAccountsAccountAccessRepository } from "@bke/accounts/prisma/repositories/postgres-account-access-repository";\n'
    'import { createPostgresAccountsAccountLifecycleRepository } from "@bke/accounts/prisma/repositories/postgres-account-lifecycle-repository";\n',
)
replace_once(
    "v2/modules/accounts/module.ts",
    '  const accountAccessRepository = createPostgresAccountsAccountAccessRepository(\n    options.connectionString,\n  );\n',
    '  const accountAccessRepository = createPostgresAccountsAccountAccessRepository(\n    options.connectionString,\n  );\n'
    '  const accountLifecycleRepository = createPostgresAccountsAccountLifecycleRepository(\n    options.connectionString,\n  );\n',
)
replace_once(
    "v2/modules/accounts/module.ts",
    '  const accountAccess = createAccountsAccountAccessCapability(accountAccessRepository);\n',
    '  const accountAccess = createAccountsAccountAccessCapability(accountAccessRepository);\n'
    '  const accountLifecycle = createAccountsAccountLifecycleCapability(accountLifecycleRepository);\n',
)
replace_once(
    "v2/modules/accounts/module.ts",
    '      {\n        id: ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,\n        value: accountAccess,\n      },\n',
    '      {\n        id: ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,\n        value: accountAccess,\n      },\n'
    '      {\n        id: ACCOUNTS_ACCOUNT_LIFECYCLE_CAPABILITY_ID,\n        value: accountLifecycle,\n      },\n',
)

# Catalog: adopt the released commercial licensing/version facts capability.
replace_once(
    "v2/modules/catalog/module.ts",
    'import {\n  CATALOG_LOOKUP_CAPABILITY_ID,\n  CATALOG_MANAGEMENT_CAPABILITY_ID,\n} from "@bke/catalog/contracts/catalog.contract";\n',
    'import {\n  CATALOG_LICENSING_VERSION_FACTS_CAPABILITY_ID,\n  CATALOG_LOOKUP_CAPABILITY_ID,\n  CATALOG_MANAGEMENT_CAPABILITY_ID,\n} from "@bke/catalog/contracts/catalog.contract";\n',
)
replace_once(
    "v2/modules/catalog/module.ts",
    'import { catalogModuleManifest } from "@bke/catalog/module.manifest";\n',
    'import { createCatalogLicensingVersionFactsCapability } from "@bke/catalog/logic/licensing-version-facts";\n'
    'import { catalogModuleManifest } from "@bke/catalog/module.manifest";\n',
)
replace_once(
    "v2/modules/catalog/module.ts",
    'import { createPostgresCatalogRepository } from "@bke/catalog/prisma/repositories/postgres-catalog-repository";\n',
    'import { createPostgresCatalogRepository } from "@bke/catalog/prisma/repositories/postgres-catalog-repository";\n'
    'import { createPostgresCatalogLicensingVersionFactsRepository } from "@bke/catalog/prisma/repositories/postgres-licensing-version-facts-repository";\n',
)
replace_once(
    "v2/modules/catalog/module.ts",
    '  const repository = createPostgresCatalogRepository(options.connectionString);\n',
    '  const repository = createPostgresCatalogRepository(options.connectionString);\n'
    '  const licensingVersionFacts = createCatalogLicensingVersionFactsCapability(\n'
    '    createPostgresCatalogLicensingVersionFactsRepository(options.connectionString),\n'
    '  );\n',
)
replace_once(
    "v2/modules/catalog/module.ts",
    '        {\n          id: CATALOG_MANAGEMENT_CAPABILITY_ID,\n          value: createCatalogManagementCapability(repository),\n        },\n',
    '        {\n          id: CATALOG_MANAGEMENT_CAPABILITY_ID,\n          value: createCatalogManagementCapability(repository),\n        },\n'
    '        {\n          id: CATALOG_LICENSING_VERSION_FACTS_CAPABILITY_ID,\n          value: licensingVersionFacts,\n        },\n',
)

# Commerce: register declared order-item facts plus released subscription-status facts.
replace_once(
    "v2/modules/commerce/module.ts",
    'import { COMMERCE_ORDER_INVOICE_CREATION_CAPABILITY_ID } from "@bke/commerce/contracts/order-invoice-creation.contract";\n',
    'import { COMMERCE_ORDER_INVOICE_CREATION_CAPABILITY_ID } from "@bke/commerce/contracts/order-invoice-creation.contract";\n'
    'import { COMMERCE_ORDER_ITEM_POLICY_LOOKUP_CAPABILITY_ID } from "@bke/commerce/contracts/order-item-policy-lookup.contract";\n',
)
replace_once(
    "v2/modules/commerce/module.ts",
    'import { COMMERCE_SETTLEMENT_REACTION_CAPABILITY_ID } from "@bke/commerce/contracts/settlement-reaction.contract";\n',
    'import { COMMERCE_SETTLEMENT_REACTION_CAPABILITY_ID } from "@bke/commerce/contracts/settlement-reaction.contract";\n'
    'import { COMMERCE_SUBSCRIPTION_STATUS_LOOKUP_CAPABILITY_ID } from "@bke/commerce/contracts/subscription-status-lookup.contract";\n',
)
replace_once(
    "v2/modules/commerce/module.ts",
    'import { createCommerceSettlementReactionCapability } from "@bke/commerce/logic/settlement-reaction";\n',
    'import { createCommerceSettlementReactionCapability } from "@bke/commerce/logic/settlement-reaction";\n'
    'import { createCommerceSubscriptionStatusLookupCapability } from "@bke/commerce/logic/subscription-status-lookup";\n',
)
replace_once(
    "v2/modules/commerce/module.ts",
    'import { createPostgresCommerceOrderInvoiceCreationRepository } from "@bke/commerce/prisma/repositories/postgres-order-invoice-creation-repository";\n',
    'import { createPostgresCommerceOrderInvoiceCreationRepository } from "@bke/commerce/prisma/repositories/postgres-order-invoice-creation-repository";\n'
    'import { createPostgresCommerceOrderItemPolicyLookupCapability } from "@bke/commerce/prisma/repositories/postgres-order-item-policy-lookup-repository";\n',
)
replace_once(
    "v2/modules/commerce/module.ts",
    'import { createPostgresCommerceSettlementReactionRepository } from "@bke/commerce/prisma/repositories/postgres-settlement-reaction-repository";\n',
    'import { createPostgresCommerceSettlementReactionRepository } from "@bke/commerce/prisma/repositories/postgres-settlement-reaction-repository";\n'
    'import { createPostgresCommerceSubscriptionStatusLookupRepository } from "@bke/commerce/prisma/repositories/postgres-subscription-status-lookup-repository";\n',
)
replace_once(
    "v2/modules/commerce/module.ts",
    '  const purchasePlanPricing = createCommercePurchasePlanPricingCapability();\n',
    '  const purchasePlanPricing = createCommercePurchasePlanPricingCapability();\n'
    '  const orderItemPolicyLookup = createPostgresCommerceOrderItemPolicyLookupCapability(\n'
    '    options.connectionString,\n'
    '  );\n'
    '  const subscriptionStatusLookup = createCommerceSubscriptionStatusLookupCapability(\n'
    '    createPostgresCommerceSubscriptionStatusLookupRepository(options.connectionString),\n'
    '  );\n',
)
replace_once(
    "v2/modules/commerce/module.ts",
    '    needs: [\n      ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,\n      LEGAL_ACCEPTANCE_CAPABILITY_ID,\n      PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID,\n      PAYMENTS_SETTLEMENT_FACT_CAPABILITY_ID,\n      ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID,\n    ],\n',
    '    needs: [\n      ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,\n      LEGAL_ACCEPTANCE_CAPABILITY_ID,\n      PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID,\n      PAYMENTS_SETTLEMENT_FACT_CAPABILITY_ID,\n      ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID,\n    ],\n'
    '    provides: [\n      ...commerceModuleManifest.provides,\n      COMMERCE_SUBSCRIPTION_STATUS_LOOKUP_CAPABILITY_ID,\n    ],\n',
)
replace_once(
    "v2/modules/commerce/module.ts",
    '        { id: COMMERCE_ZERO_PAYMENT_FULFILLMENT_CAPABILITY_ID, value: zeroPaymentFulfillment },\n',
    '        { id: COMMERCE_ZERO_PAYMENT_FULFILLMENT_CAPABILITY_ID, value: zeroPaymentFulfillment },\n'
    '        { id: COMMERCE_ORDER_ITEM_POLICY_LOOKUP_CAPABILITY_ID, value: orderItemPolicyLookup },\n'
    '        { id: COMMERCE_SUBSCRIPTION_STATUS_LOOKUP_CAPABILITY_ID, value: subscriptionStatusLookup },\n',
)

# Licensing: replace the incomplete reveal-only adapter with real released commercial composition.
Path("v2/modules/licensing/module.ts").write_text(r'''import { createHmac } from "node:crypto";
import {
  ACCOUNTS_ACCOUNT_LIFECYCLE_CAPABILITY_ID,
  type AccountsAccountLifecycleCapability,
} from "@bke/accounts/contracts/account-lifecycle.contract";
import {
  CATALOG_LICENSING_VERSION_FACTS_CAPABILITY_ID,
  type CatalogLicensingVersionFactsCapability,
} from "@bke/catalog/contracts/catalog.contract";
import {
  COMMERCE_ORDER_ITEM_POLICY_LOOKUP_CAPABILITY_ID,
  type CommerceOrderItemPolicyLookupCapability,
} from "@bke/commerce/contracts/order-item-policy-lookup.contract";
import {
  COMMERCE_SUBSCRIPTION_STATUS_LOOKUP_CAPABILITY_ID,
  type CommerceSubscriptionStatusLookupCapability,
} from "@bke/commerce/contracts/subscription-status-lookup.contract";
import { LICENSING_COMMERCIAL_LEASE_CAPABILITY_ID } from "@bke/licensing/contracts/commercial-lease.contract";
import { LICENSING_LICENSE_KEY_REVEAL_CAPABILITY_ID } from "@bke/licensing/contracts/license-key-reveal.contract";
import {
  LICENSING_TRANSFER_POLICY_CAPABILITY_ID,
  isTransferAllowed,
} from "@bke/licensing/contracts/transfer-policy.contract";
import { createCommercialLeaseCapability } from "@bke/licensing/logic/commercial-lease";
import type { CommercialTransferEligibilityProvider } from "@bke/licensing/logic/commercial-lease-ports";
import { createCommercialLicenseContextProvider } from "@bke/licensing/logic/commercial-license-context";
import {
  resolveCommercialPrivateKey,
  type CommercialSigningKeyBootstrap,
} from "@bke/licensing/logic/commercial-signing-registry";
import { createLicensingLicenseKeyRevealCapability } from "@bke/licensing/logic/license-key-reveal";
import { licensingModuleManifest } from "@bke/licensing/module.manifest";
import { createPostgresCommercialLeaseStore } from "@bke/licensing/prisma/repositories/postgres-commercial-lease-store";
import { createPostgresCommercialSigningKeyProvider } from "@bke/licensing/prisma/repositories/postgres-commercial-signing-key-provider";
import { createPostgresLicensingLicenseKeyRevealRepository } from "@bke/licensing/prisma/repositories/postgres-license-key-reveal-repository";
import { createPostgresLicensingLicenseLookupRepository } from "@bke/licensing/prisma/repositories/postgres-license-lookup-repository";
import { createPostgresLicensingTransferPolicyCapability } from "@bke/licensing/prisma/repositories/postgres-transfer-policy-repository";
import { createAesGcmLicensingLicenseKeyDecrypter } from "@bke/licensing/providers/aes-gcm-license-key-decrypter";
import { createEd25519CommercialLeaseSigner } from "@bke/licensing/providers/ed25519-commercial-lease-signer";
import { createSystemLicensingClock } from "@bke/licensing/providers/system-licensing-clock";
import type { CapabilityModule, CapabilityResolver } from "../../contracts/capability";

export interface LicensingModuleOptions {
  readonly connectionString: string;
  readonly licensePepper: string;
}

function commercialSigningBootstrap(): CommercialSigningKeyBootstrap | undefined {
  const keyId = process.env.LICENSE_SIGNING_KEY_ID?.trim();
  const publicKey = process.env.LICENSE_SIGNING_PUBLIC_KEY?.trim();
  const privateKey = process.env.LICENSE_SIGNING_PRIVATE_KEY?.trim();
  if (!keyId || !publicKey || !privateKey) return undefined;
  return Object.freeze({
    keyId,
    publicKey,
    privateKeyReference: "env:LICENSE_SIGNING_PRIVATE_KEY",
  });
}

export function createLicensingModule(options: LicensingModuleOptions): CapabilityModule {
  const licenseKeyReveal = createLicensingLicenseKeyRevealCapability({
    repository: createPostgresLicensingLicenseKeyRevealRepository(options.connectionString),
    decrypter: createAesGcmLicensingLicenseKeyDecrypter(options.licensePepper),
    clock: createSystemLicensingClock(),
  });
  const licenseLookup = createPostgresLicensingLicenseLookupRepository(options.connectionString);
  const leaseStore = createPostgresCommercialLeaseStore(options.connectionString);
  const signingKeys = createPostgresCommercialSigningKeyProvider(
    options.connectionString,
    commercialSigningBootstrap(),
  );
  const signer = createEd25519CommercialLeaseSigner({
    resolve: resolveCommercialPrivateKey,
  });
  const transferPolicy = createPostgresLicensingTransferPolicyCapability(options.connectionString);

  const hostManifest = Object.freeze({
    ...licensingModuleManifest,
    needs: [
      ACCOUNTS_ACCOUNT_LIFECYCLE_CAPABILITY_ID,
      CATALOG_LICENSING_VERSION_FACTS_CAPABILITY_ID,
      COMMERCE_ORDER_ITEM_POLICY_LOOKUP_CAPABILITY_ID,
      COMMERCE_SUBSCRIPTION_STATUS_LOOKUP_CAPABILITY_ID,
    ],
  });

  return Object.freeze({
    manifest: hostManifest,
    start(resolver: CapabilityResolver) {
      const accounts = resolver.get<AccountsAccountLifecycleCapability>(
        ACCOUNTS_ACCOUNT_LIFECYCLE_CAPABILITY_ID,
      );
      const catalog = resolver.get<CatalogLicensingVersionFactsCapability>(
        CATALOG_LICENSING_VERSION_FACTS_CAPABILITY_ID,
      );
      const orderItems = resolver.get<CommerceOrderItemPolicyLookupCapability>(
        COMMERCE_ORDER_ITEM_POLICY_LOOKUP_CAPABILITY_ID,
      );
      const subscriptions = resolver.get<CommerceSubscriptionStatusLookupCapability>(
        COMMERCE_SUBSCRIPTION_STATUS_LOOKUP_CAPABILITY_ID,
      );

      const contexts = createCommercialLicenseContextProvider({
        licenses: licenseLookup,
        accounts,
        subscriptions,
        catalog,
      });

      const transfers: CommercialTransferEligibilityProvider = Object.freeze({
        async isTransferAllowed(input) {
          const orderItem = await orderItems.findByOrderItemId(input.orderItemId);
          if (orderItem.status !== "FOUND") return false;
          const policy = await transferPolicy.findByPolicyId(input.policyId);
          if (policy.status !== "FOUND") return false;
          return isTransferAllowed({
            requestedPolicyId: input.policyId,
            orderItemPolicyId: orderItem.value.policyId,
            policy: policy.value,
          });
        },
      });

      const commercialLease = createCommercialLeaseCapability({
        store: leaseStore,
        contexts,
        keys: signingKeys,
        signer,
        hasher: Object.freeze({
          hash(licenseKey: string) {
            return createHmac("sha256", options.licensePepper).update(licenseKey).digest("hex");
          },
        }),
        transfers,
      });

      return [
        {
          id: LICENSING_LICENSE_KEY_REVEAL_CAPABILITY_ID,
          value: licenseKeyReveal,
        },
        {
          id: LICENSING_COMMERCIAL_LEASE_CAPABILITY_ID,
          value: commercialLease,
        },
        {
          id: LICENSING_TRANSFER_POLICY_CAPABILITY_ID,
          value: transferPolicy,
        },
      ];
    },
  });
}
''')

print("temporary V2 commercial lease patch applied")

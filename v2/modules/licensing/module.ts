import { createHmac } from "node:crypto";
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
import { LICENSING_SIGNING_KEY_REGISTRY_CAPABILITY_ID } from "@bke/licensing/contracts/signing-key-registry.contract";
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
import { createPostgresLicensingSigningKeyRegistryCapability } from "@bke/licensing/prisma/repositories/postgres-signing-key-registry-repository";
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
  const signingKeyRegistry = createPostgresLicensingSigningKeyRegistryCapability(
    options.connectionString,
    commercialSigningBootstrap(),
  );
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
        async isTransferAllowed(
          input: Parameters<CommercialTransferEligibilityProvider["isTransferAllowed"]>[0],
        ) {
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
        {
          id: LICENSING_SIGNING_KEY_REGISTRY_CAPABILITY_ID,
          value: signingKeyRegistry,
        },
      ];
    },
  });
}

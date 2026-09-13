import "server-only";

import {
  LICENSING_SIGNING_KEY_REGISTRY_CAPABILITY_ID,
  type LicensingSigningKeyRegistryCapability,
} from "@bke/licensing/contracts/signing-key-registry.contract";
import { getV2WebApplication } from "../runtime";

async function signingKeyRegistry(): Promise<LicensingSigningKeyRegistryCapability> {
  const application = await getV2WebApplication();
  return application.get<LicensingSigningKeyRegistryCapability>(
    LICENSING_SIGNING_KEY_REGISTRY_CAPABILITY_ID,
  );
}

export async function ensureLicensingSigningKey(): Promise<void> {
  await (await signingKeyRegistry()).ensure();
}

export async function activeLicensingSigningKey() {
  return (await signingKeyRegistry()).active();
}

export async function listPublicLicensingSigningKeys() {
  return (await signingKeyRegistry()).listPublic();
}

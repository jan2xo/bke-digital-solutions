import type { CapabilityModule } from "../../contracts/capability";
import { LICENSING_LICENSE_KEY_REVEAL_CAPABILITY_ID } from "@bke/licensing/contracts/license-key-reveal.contract";
import { createLicensingLicenseKeyRevealCapability } from "@bke/licensing/logic/license-key-reveal";
import { licensingModuleManifest } from "@bke/licensing/module.manifest";
import { createPostgresLicensingLicenseKeyRevealRepository } from "@bke/licensing/prisma/repositories/postgres-license-key-reveal-repository";
import { createAesGcmLicensingLicenseKeyDecrypter } from "@bke/licensing/providers/aes-gcm-license-key-decrypter";
import { createSystemLicensingClock } from "@bke/licensing/providers/system-licensing-clock";

export interface LicensingModuleOptions {
  readonly connectionString: string;
  readonly licensePepper: string;
}

export function createLicensingModule(options: LicensingModuleOptions): CapabilityModule {
  const licenseKeyReveal = createLicensingLicenseKeyRevealCapability({
    repository: createPostgresLicensingLicenseKeyRevealRepository(options.connectionString),
    decrypter: createAesGcmLicensingLicenseKeyDecrypter(options.licensePepper),
    clock: createSystemLicensingClock(),
  });

  return Object.freeze({
    manifest: licensingModuleManifest,
    start: async () => [
      {
        id: LICENSING_LICENSE_KEY_REVEAL_CAPABILITY_ID,
        value: licenseKeyReveal,
      },
    ],
  });
}

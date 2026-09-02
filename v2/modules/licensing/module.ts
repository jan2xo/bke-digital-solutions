import type { CapabilityModule } from "../../contracts/capability";
import { LICENSING_LICENSE_KEY_REVEAL_CAPABILITY_ID } from "./contracts/license-key-reveal.contract";
import { createLicensingLicenseKeyRevealCapability } from "./logic/license-key-reveal";
import { licensingModuleManifest } from "./module.manifest";
import { createPostgresLicensingLicenseKeyRevealRepository } from "./prisma/repositories/postgres-license-key-reveal-repository";
import { createAesGcmLicensingLicenseKeyDecrypter } from "./providers/aes-gcm-license-key-decrypter";
import { createSystemLicensingClock } from "./providers/system-licensing-clock";

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

import { describe, expect, it } from "vitest";
import { LICENSING_ENTITLEMENT_MANAGEMENT_CAPABILITY_ID } from "@bke/licensing/contracts/entitlement-management.contract";
import { licensingModuleManifest } from "@bke/licensing/module.manifest";
import { createLicensingModule } from "@/v2/modules/licensing/module";

describe("Licensing entitlement owner adoption boundary", () => {
  it("keeps entitlement management package-owned but transaction-bound outside the singleton runtime manifest", () => {
    expect(licensingModuleManifest.provides).toContain(LICENSING_ENTITLEMENT_MANAGEMENT_CAPABILITY_ID);

    const hostModule = createLicensingModule({
      connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/bke_test",
      licensePepper: "licensing-entitlement-owner-adoption-test-pepper",
    });

    expect(hostModule.manifest.moduleId).toBe("bke.licensing");
    expect(hostModule.manifest.provides).not.toContain(LICENSING_ENTITLEMENT_MANAGEMENT_CAPABILITY_ID);
  });
});

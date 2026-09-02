import { describe, expect, it } from "vitest";
import { LICENSING_LICENSE_KEY_REVEAL_CAPABILITY_ID } from "../contracts/license-key-reveal.contract";
import { createLicensingModule } from "../module";

const unusedResolver = {
  has: () => false,
  get: () => {
    throw new Error("Licensing reveal module must not resolve sibling capabilities internally.");
  },
};

describe("Licensing module composition", () => {
  it("registers the key reveal capability without sibling-domain dependencies", async () => {
    const module = createLicensingModule({
      connectionString: "postgresql://bke:bke@localhost:5432/bke_v2_licensing",
      licensePepper: "composition-pepper",
    });

    expect(module.manifest.moduleId).toBe("bke.licensing");
    expect(module.manifest.needs).toEqual([]);
    expect(module.manifest.provides).toEqual([
      LICENSING_LICENSE_KEY_REVEAL_CAPABILITY_ID,
    ]);

    const registrations = await module.start(unusedResolver);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.id).toBe(LICENSING_LICENSE_KEY_REVEAL_CAPABILITY_ID);
    expect(registrations[0]?.value).toMatchObject({ reveal: expect.any(Function) });
  });
});

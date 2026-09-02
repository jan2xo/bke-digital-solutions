import { describe, expect, it } from "vitest";
import { composeCapabilities } from "../../../platform/composition/composer";
import {
  ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID,
  type EntitlementsDurableRightGrantCapability,
} from "../contracts/durable-right-grant.contract";
import { createEntitlementsModule } from "../module";

describe("Entitlements module composition", () => {
  it("registers durable-right grant without touching persistence at startup", async () => {
    const application = await composeCapabilities([
      createEntitlementsModule({ connectionString: "postgresql://unused.invalid/entitlements" }),
    ]);

    expect(application.moduleIds).toContain("entitlements");
    expect(application.has(ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID)).toBe(true);
    expect(
      typeof application.get<EntitlementsDurableRightGrantCapability>(
        ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID,
      ).grant,
    ).toBe("function");
  });
});

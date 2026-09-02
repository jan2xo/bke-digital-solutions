import { describe, expect, it } from "vitest";
import { composeCapabilities } from "../../../platform/composition/composer";
import {
  LEGAL_ACCEPTANCE_CAPABILITY_ID,
  type LegalAcceptanceCapability,
} from "../contracts/acceptance.contract";
import { createLegalModule } from "../module";

describe("Legal module composition", () => {
  it("registers Legal acceptance without touching persistence at startup", async () => {
    const application = await composeCapabilities([
      createLegalModule({ connectionString: "postgresql://unused.invalid/legal" }),
    ]);

    expect(application.moduleIds).toContain("legal");
    expect(application.has(LEGAL_ACCEPTANCE_CAPABILITY_ID)).toBe(true);
    const acceptance = application.get<LegalAcceptanceCapability>(LEGAL_ACCEPTANCE_CAPABILITY_ID);
    expect(typeof acceptance.record).toBe("function");
    expect(typeof acceptance.check).toBe("function");
  });
});

import { describe, expect, it } from "vitest";
import { selectEligibleRelease } from "../../../lib/releases/resolution";

describe("MAJOR_VERSION release entitlement fallback", () => {
  it("selects the newest release within the entitled major before choosing latest", () => {
    const selected = selectEligibleRelease(
      [{ version: "2.9.5" }, { version: "3.0.0" }],
      "MAJOR_VERSION",
      "2.4.0",
    );
    expect(selected?.version).toBe("2.9.5");
  });

  it("still selects the newest compatible release for lifetime entitlement", () => {
    const selected = selectEligibleRelease(
      [{ version: "2.9.5" }, { version: "3.0.0" }],
      "LIFETIME",
      "2.4.0",
    );
    expect(selected?.version).toBe("3.0.0");
  });
});

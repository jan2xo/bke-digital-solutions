import { describe, expect, it } from "vitest";
import { compareSemanticVersions } from "../../../lib/releases/versioning";

describe("update policy semantic coherence", () => {
  it.each([
    ["2.9.0", "2.1.0", false],
    ["3.0.0", "2.9.9", false],
    ["2.1.0", "2.1.0", true],
    ["2.0.0", "2.1.0", true],
  ])("minimum %s and latest %s", (minimum, latest, accepted) => {
    expect(compareSemanticVersions(minimum, latest) <= 0).toBe(accepted);
  });

  it.each(["1", "1.2", "v1.2.3", "1.2.3.4", "release"])("rejects malformed version %s", (value) => {
    expect(() => compareSemanticVersions(value, "2.1.0")).toThrow("invalid version");
  });
});

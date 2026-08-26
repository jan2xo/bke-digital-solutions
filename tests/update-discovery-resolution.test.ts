import { describe, expect, it } from "vitest";
import { compareSemanticVersions, parseSemanticVersion, selectNewestSemanticRelease } from "@/lib/releases/versioning";

describe("Agent update release selection", () => {
  it("selects the newest semantic release newer than the installed version", () => {
    expect(selectNewestSemanticRelease([{ version: "1.2.0" }, { version: "1.10.0" }, { version: "1.1.9" }], "1.1.0")?.version).toBe("1.10.0");
  });

  it("returns no update when candidates are not newer and ignores malformed candidates", () => {
    expect(selectNewestSemanticRelease([{ version: "release" }, { version: "1.0.0" }], "1.0.0")).toBeNull();
  });

  it("rejects malformed installed versions", () => {
    expect(() => selectNewestSemanticRelease([{ version: "2.0.0" }], "v1")).toThrow("INVALID_SEMANTIC_VERSION");
  });

  it("orders stable versions after prereleases", () => {
    expect(compareSemanticVersions("2.0.0", "2.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareSemanticVersions("2.0.0-rc.10", "2.0.0-rc.2")).toBeGreaterThan(0);
  });

  it("rejects non-canonical numeric components", () => {
    expect(() => parseSemanticVersion("01.0.0")).toThrow("INVALID_SEMANTIC_VERSION");
  });

  it("can constrain an existing major-version update entitlement", () => {
    expect(selectNewestSemanticRelease([{ version: "2.9.0" }, { version: "3.0.0" }], "2.1.0", true)?.version).toBe("2.9.0");
  });
});

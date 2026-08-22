import { describe, expect, it } from "vitest";
import { classifyArtifact } from "@/lib/commissioning/types";

describe("BKE commissioning classification", () => {
  it("supports legacy binaries, archives, and scripts without GitHub", () => {
    expect(classifyArtifact("old-installer.exe", "application/octet-stream")).toBe("WINDOWS_BINARY");
    expect(classifyArtifact("vMix-script.js", "text/javascript")).toBe("SCRIPT");
    expect(classifyArtifact("plugin.zip", "application/zip")).toBe("ZIP_ARCHIVE");
  });
  it("uses a generic fallback instead of fabricating certainty", () => {
    expect(classifyArtifact("unknown.dat", "application/octet-stream")).toBe("GENERIC_BINARY");
  });
});

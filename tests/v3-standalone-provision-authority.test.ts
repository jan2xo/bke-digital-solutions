import { describe, expect, it } from "vitest";
import {
  githubLatestReleaseUrl,
  githubReleaseRepository,
} from "@/platform/distribution/github-releases";

describe("GitHub release distribution authority", () => {
  it("resolves only explicitly configured product repositories", () => {
    expect(githubReleaseRepository("bke-render-dock"))
      .toBe("jan2xo/BKE_RENDER_DOCK");
    expect(githubReleaseRepository("bke-air-stack"))
      .toBe("jan2xo/BKE_AIR_STACK");
    expect(githubReleaseRepository("unknown-product")).toBeNull();
  });

  it("derives browser release URLs from the same repository authority", () => {
    expect(githubLatestReleaseUrl("bke-render-dock"))
      .toBe("https://github.com/jan2xo/BKE_RENDER_DOCK/releases/latest");
    expect(githubLatestReleaseUrl("unknown-product")).toBeNull();
  });
});

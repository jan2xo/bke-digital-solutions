import { describe, expect, it } from "vitest";
import { isCustomerReleaseEligible } from "@/lib/releases/eligibility";
import { githubLatestReleaseUrl, githubVersionReleaseUrl } from "@/platform/distribution/github-releases";

describe("customer release visibility and GitHub distribution links", () => {
  it("keeps draft, inactive and unpublished versions out of the customer catalog", () => {
    expect(isCustomerReleaseEligible({ lifecycle: "DRAFT", active: true, publishedAt: new Date() })).toBe(false);
    expect(isCustomerReleaseEligible({ lifecycle: "STABLE", active: true, publishedAt: null })).toBe(false);
    expect(isCustomerReleaseEligible({ lifecycle: "STABLE", active: false, publishedAt: new Date() })).toBe(false);
  });
  it("accepts published active stable and LTS releases", () => {
    expect(isCustomerReleaseEligible({ lifecycle: "STABLE", active: true, publishedAt: new Date() })).toBe(true);
    expect(isCustomerReleaseEligible({ lifecycle: "LTS", active: true, publishedAt: new Date() })).toBe(true);
  });
  it("links catalog versions to exact mapped GitHub tags", () => {
    expect(githubVersionReleaseUrl("bke-render-dock", "1.0.3")).toBe(
      "https://github.com/jan2xo/BKE_RENDER_DOCK/releases/tag/v1.0.3",
    );
    expect(githubVersionReleaseUrl("bke-air-stack", "2.1.0-beta.1")).toBe(
      "https://github.com/jan2xo/BKE_AIR_STACK/releases/tag/v2.1.0-beta.1",
    );
    expect(githubLatestReleaseUrl("bke-render-dock")).toBe(
      "https://github.com/jan2xo/BKE_RENDER_DOCK/releases/latest",
    );
  });
  it("never invents a repository or accepts an invalid release tag", () => {
    expect(githubVersionReleaseUrl("unknown", "1.0.0")).toBeNull();
    expect(githubVersionReleaseUrl("bke-render-dock", "../releases/latest")).toBeNull();
    expect(githubVersionReleaseUrl("bke-render-dock", "1.0.0/../../other")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { isCustomerReleaseEligible } from "@/lib/releases/eligibility";

describe("customer release eligibility", () => {
  it("keeps drafts and unpublished versions out of the customer release set", () => {
    expect(isCustomerReleaseEligible({ lifecycle: "DRAFT", active: true, publishedAt: new Date() })).toBe(false);
    expect(isCustomerReleaseEligible({ lifecycle: "STABLE", active: true, publishedAt: null })).toBe(false);
  });

  it("accepts published active stable and LTS versions", () => {
    expect(isCustomerReleaseEligible({ lifecycle: "STABLE", active: true, publishedAt: new Date() })).toBe(true);
    expect(isCustomerReleaseEligible({ lifecycle: "LTS", active: true, publishedAt: new Date() })).toBe(true);
  });

  it("does not treat inactive releases as downloadable", () => {
    expect(isCustomerReleaseEligible({ lifecycle: "STABLE", active: false, publishedAt: new Date() })).toBe(false);
  });
});

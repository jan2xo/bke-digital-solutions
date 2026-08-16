import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { isCustomerReleaseEligible } from "@/lib/releases/eligibility";
import { releaseReadiness } from "@/lib/supply-chain/readiness";

vi.mock("@/lib/env", () => ({ env: { SUPPLY_CHAIN_SIGNING_KEY_ID: "supply-test" } }));

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

  it("requires trusted publication readiness in the artifact download resolver", () => {
    const readiness = releaseReadiness({
      id: "version-1",
      productId: "product-1",
      version: "1.0.0",
      product: { slug: "product" },
      artifacts: [{ id: "artifact-1", objectKey: "artifacts/a.bin", sha256: "a".repeat(64), sizeBytes: 1n, contentType: "application/octet-stream" }],
      supplyChainEvidence: null,
      backupEvidence: null,
      complianceEvidence: null,
      migrationEvidence: null,
      approvals: [],
    });
    expect(readiness.publishable).toBe(false);
    expect(readiness.items.filter((item) => item.status === "BLOCKED").map((item) => item.key)).toEqual(expect.arrayContaining(["signature", "malware", "sbom", "provenance"]));
  });
});

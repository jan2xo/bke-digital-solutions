import { describe, expect, it } from "vitest";
import { acceptedVersionSchema, isVersionAccepted, productIdSchema, validateAcceptedVersionRange } from "@/lib/product-identity";

describe("canonical product identity", () => {
  it("keeps database, catalog, and licensing identities conceptually distinct", () => {
    const product = { id: "cm123internal", slug: "trial-product-web", productId: "bke-trial-product" };
    expect(product.id).not.toBe(product.slug);
    expect(product.id).not.toBe(product.productId);
    expect(product.slug).not.toBe(product.productId);
  });

  it("accepts stable lowercase hyphenated identifiers only", () => {
    expect(productIdSchema.parse("bke-trial-product")).toBe("bke-trial-product");
    expect(() => productIdSchema.parse("BKE Trial Product")).toThrow();
    expect(() => productIdSchema.parse("trial_product")).toThrow();
  });

  it.each(["1.0.0", "1.0.1", "1.0.9", "1.1.0"])("accepts %s inside the configured range", (version) => {
    expect(isVersionAccepted(version, "1.0.0", "1.1.0")).toBe(true);
  });

  it.each(["1.1.1", "1.1.2", "0.9.9", "2.0.0"])("rejects %s outside the configured range", (version) => {
    expect(isVersionAccepted(version, "1.0.0", "1.1.0")).toBe(false);
  });

  it("supports an exact-version policy and rejects inverted or malformed ranges", () => {
    expect(isVersionAccepted("1.0.0", "1.0.0", "1.0.0")).toBe(true);
    expect(isVersionAccepted("1.0.1", "1.0.0", "1.0.0")).toBe(false);
    expect(() => validateAcceptedVersionRange("1.1.0", "1.0.0")).toThrow("INVALID_VERSION_POLICY");
    expect(() => acceptedVersionSchema.parse("1.0")).toThrow();
  });

  it("preserves unrestricted legacy semantics when both bounds are absent", () => {
    expect(isVersionAccepted("9.9.9", null, null)).toBe(true);
  });

  it("supports semver prerelease and build metadata according to semver rules", () => {
    expect(isVersionAccepted("1.0.0-beta.1", "1.0.0-beta.1", "1.0.0")).toBe(true);
    expect(isVersionAccepted("1.0.0+build.7", "1.0.0", "1.0.0")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { acceptedVersionSchema, assertProductIdChangeAllowed, isVersionAccepted, productIdSchema, validateAcceptedVersionRange } from "@/lib/product-identity";

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

  it("allows first assignment for legacy products even after lifecycle history", () => {
    expect(() => assertProductIdChangeAllowed({ existingProductId: null, requestedProductId: "bke-trial-product", lifecycleLocked: true })).not.toThrow();
  });

  it("keeps assigned product IDs immutable once lifecycle-locked", () => {
    expect(() => assertProductIdChangeAllowed({ existingProductId: "bke-trial-product", requestedProductId: "bke-other-product", lifecycleLocked: true })).toThrow("PRODUCT_ID_IMMUTABLE");
  });

  it("allows saving the same assigned product ID", () => {
    expect(() => assertProductIdChangeAllowed({ existingProductId: "bke-trial-product", requestedProductId: "bke-trial-product", lifecycleLocked: true })).not.toThrow();
  });

  it.each(["1.0.0", "1.0.1", "1.0.9", "1.1.0"])("accepts %s inside the configured range", (version) => expect(isVersionAccepted(version, "1.0.0", "1.1.0")).toBe(true));
  it.each(["1.1.1", "1.1.2", "0.9.9", "2.0.0"])("rejects %s outside the configured range", (version) => expect(isVersionAccepted(version, "1.0.0", "1.1.0")).toBe(false));
  it("handles exact, malformed, inverted, and unrestricted policies", () => {
    expect(isVersionAccepted("1.0.0", "1.0.0", "1.0.0")).toBe(true);
    expect(isVersionAccepted("1.0.1", "1.0.0", "1.0.0")).toBe(false);
    expect(() => validateAcceptedVersionRange("1.1.0", "1.0.0")).toThrow("INVALID_VERSION_POLICY");
    expect(() => acceptedVersionSchema.parse("1.0")).toThrow();
    expect(isVersionAccepted("9.9.9", null, null)).toBe(true);
  });
});

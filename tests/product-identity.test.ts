import { describe, expect, it } from "vitest";
import { productIdSchema } from "@/lib/product-identity";

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
});

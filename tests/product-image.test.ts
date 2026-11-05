import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isLegacyProductImageObjectKey, resolveProductImageUrl } from "@/apps/web/catalog/product-image";

const valid = "https://raw.githubusercontent.com/jan2xo/bke-digital-solutions/main/public/bke-icon.png";

describe("product GitHub image references", () => {
  it("accepts canonical public raster images from the BKE owner", () => {
    expect(resolveProductImageUrl(valid)).toBe(valid);
  });

  it.each([
    "https://github.com/jan2xo/repo/blob/main/image.png",
    "https://raw.githubusercontent.com.evil.example/jan2xo/repo/main/image.png",
    "https://attacker@raw.githubusercontent.com/jan2xo/repo/main/image.png",
    "https://raw.githubusercontent.com:443/jan2xo/repo/main/image.png",
    "https://raw.githubusercontent.com/jan2xo/repo/main/image.png?token=secret",
    "https://raw.githubusercontent.com/jan2xo/repo/main/image.png#fragment",
    "https://raw.githubusercontent.com/jan2xo/repo/main/image.svg",
    "products/product-1/images/legacy.png",
  ])("rejects untrusted or non-raster reference %s", (value) => {
    expect(resolveProductImageUrl(value)).toBeNull();
  });

  it("only recognizes existing product image object-key cleanup paths", () => {
    expect(isLegacyProductImageObjectKey("products/p1/images/123e4567-e89b-42d3-a456-426614174000.webp", "p1")).toBe(true);
    expect(isLegacyProductImageObjectKey(valid, "p1")).toBe(false);
    expect(isLegacyProductImageObjectKey("products/p2/images/123e4567-e89b-42d3-a456-426614174000.webp", "p1")).toBe(false);
  });

  it("keeps same-origin admin authorization on the URL-save endpoint", () => {
    const route = readFileSync("app/api/admin/products/[id]/image/route.ts", "utf8");
    expect(route).toContain("assertSameOrigin(request)");
    expect(route).toContain("requireAdmin()");
    expect(route).toContain("resolveProductImageUrl");
    expect(route).not.toContain("request.formData()");
    expect(route).not.toContain("uploadObject");
  });

  it("never queues a GitHub URL as a legacy S3 object key", () => {
    for (const path of ["app/api/admin/products/[id]/route.ts", "app/api/admin/products/[id]/image/route.ts", "apps/web/catalog/product-deletion.ts"]) {
      expect(readFileSync(path, "utf8")).toContain("isLegacyProductImageObjectKey");
    }
  });

  it("validates imageKey on product create and update paths", () => {
    for (const path of ["app/api/admin/products/route.ts", "app/api/admin/products/[id]/route.ts"]) {
      expect(readFileSync(path, "utf8")).toContain("resolveProductImageUrl");
    }
  });
});

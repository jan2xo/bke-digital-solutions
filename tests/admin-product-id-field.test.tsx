import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CATALOG_PRODUCT_ID_MAX_LENGTH,
  isCatalogProductId,
} from "@bke/catalog/logic/product-identity-policy";
import {
  AdminProductIdField,
  ADMIN_PRODUCT_ID_INPUT_PATTERN,
} from "@/components/admin-product-id-field";

describe("administrator product ID input", () => {
  const browserPattern = new RegExp(`^(?:${ADMIN_PRODUCT_ID_INPUT_PATTERN})$`);

  it("accepts the same stable product IDs as the published Catalog policy", () => {
    for (const value of ["a", "a1", "bke-media-organizer", "render-dock", `a${"1".repeat(CATALOG_PRODUCT_ID_MAX_LENGTH - 1)}`]) {
      expect(browserPattern.test(value)).toBe(true);
      expect(isCatalogProductId(value)).toBe(true);
    }
  });

  it("rejects identifiers previously accepted by the too-broad HTML form", () => {
    for (const value of ["BKE Media Organizer", "bke_media_organizer", "1-product", "bke--media", "bke-media-", "bke media", "bke.media"]) {
      expect(browserPattern.test(value)).toBe(false);
      expect(isCatalogProductId(value)).toBe(false);
    }
  });

  it("renders the canonical length limit and actionable hint on create and edit", () => {
    for (const value of [undefined, "bke-media-organizer"]) {
      const markup = renderToStaticMarkup(<AdminProductIdField defaultValue={value} />);
      expect(markup).toContain('name="productId"');
      expect(markup).toContain(`pattern="${ADMIN_PRODUCT_ID_INPUT_PATTERN}"`);
      expect(markup.toLowerCase()).toContain(`maxlength="${CATALOG_PRODUCT_ID_MAX_LENGTH}"`);
      expect(markup).toContain('placeholder="bke-media-organizer"');
      expect(markup).toContain("no spaces or underscores");
      if (value) expect(markup).toContain(`value="${value}"`);
    }
  });
});

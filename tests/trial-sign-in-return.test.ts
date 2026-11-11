import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { trialSignInHref } from "@/apps/web/trials/trial-sign-in-path";
import { safeLocalRedirect } from "@/apps/web/security/redirect";

describe("anonymous trial sign-in preserves the selected product", () => {
  it("returns to the exact product rather than the catalog index", () => {
    const href = trialSignInHref("render-dock");
    expect(href).toBe("/login?returnTo=%2Fproducts%2Frender-dock");
    const returnTo = new URL(href, "https://bkedigitalsolutions.com").searchParams.get("returnTo");
    expect(safeLocalRedirect(returnTo)).toBe("/products/render-dock");
    expect(returnTo).not.toBe("/products");
  });

  it("encodes a slug as a single URL path segment and never creates an external redirect", () => {
    const href = trialSignInHref("//outside.example/path");
    const decoded = new URL(href, "https://bkedigitalsolutions.com").searchParams.get("returnTo");
    expect(decoded).toBe("/products/%2F%2Foutside.example%2Fpath");
    expect(safeLocalRedirect(decoded)).toBe(decoded);
    expect(safeLocalRedirect("//outside.example/path")).toBe("/dashboard");
    expect(safeLocalRedirect("https://outside.example/path")).toBe("/dashboard");
  });

  it("keeps the current active product wired to the anonymous CTA and leaves trial authority unchanged", () => {
    const product = readFileSync("app/products/[slug]/page.tsx", "utf8");
    const button = readFileSync("components/trial-start-button.tsx", "utf8");
    expect(product).toContain("productSlug={product.slug}");
    expect(button).toContain("href={trialSignInHref(productSlug)}");
    expect(button).not.toContain('encodeURIComponent("/products")');
    expect(button).toContain('fetch("/api/trials"');
    expect(button).toContain('router.push(`/dashboard/accounts/${accountId}`)');
  });
});

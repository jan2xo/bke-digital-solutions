import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { productFindMany } = vi.hoisted(() => ({ productFindMany: vi.fn() }));
vi.mock("@/platform/host/db", () => ({
  db: { product: { findMany: productFindMany } },
}));

import robots from "@/app/robots";
import sitemap, { dynamic as sitemapRendering } from "@/app/sitemap";
import {
  CRAWLER_EXCLUDED_PATHS,
  PUBLIC_SHARE_IMAGE,
  PUBLIC_SITE_ORIGIN,
  PUBLIC_SITEMAP_PATHS,
  publicPageMetadata,
} from "@/apps/web/public-seo";

describe("public SEO and crawler boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    productFindMany.mockResolvedValue([]);
  });

  it("publishes robots.txt with one canonical HTTPS sitemap and private crawl exclusions", () => {
    const result = robots();
    const rules = result.rules as { userAgent: string; allow: string; disallow: string[] };
    expect(result.sitemap).toBe("https://bkedigitalsolutions.com/sitemap.xml");
    expect(result.host).toBe(PUBLIC_SITE_ORIGIN);
    expect(rules).toMatchObject({ userAgent: "*", allow: "/" });
    expect(rules.disallow).toEqual([...CRAWLER_EXCLUDED_PATHS]);
    for (const route of ["/api/checkout", "/admin", "/admin/payments", "/dashboard", "/dashboard/notifications",
      "/checkout", "/auth/google/callback", "/login", "/redeem", "/support", "/legal/accept"]) {
      expect(rules.disallow.some((disallowed) => route.startsWith(disallowed)), route).toBe(true);
    }
    expect(rules.disallow).not.toContain("/products");
  });

  it("serves a dynamic sitemap containing only approved public routes and active nonarchived products", async () => {
    expect(sitemapRendering).toBe("force-dynamic");
    const updatedAt = new Date("2026-11-10T12:00:00.000Z");
    productFindMany.mockResolvedValue([
      { slug: "bke-render-dock", updatedAt },
      { slug: "bke-media-organizer", updatedAt },
    ]);
    const result = await sitemap();
    expect(productFindMany).toHaveBeenCalledOnce();
    expect(productFindMany).toHaveBeenCalledWith({
      where: { active: true, archivedAt: null },
      select: { slug: true, updatedAt: true },
      orderBy: { slug: "asc" },
    });
    expect(result.map((item) => item.url)).toEqual([
      ...PUBLIC_SITEMAP_PATHS.map((path) => new URL(path, PUBLIC_SITE_ORIGIN).toString()),
      "https://bkedigitalsolutions.com/products/bke-render-dock",
      "https://bkedigitalsolutions.com/products/bke-media-organizer",
    ]);
    expect(result.at(-1)?.lastModified).toEqual(updatedAt);
    expect(result.every((item) => item.url.startsWith(PUBLIC_SITE_ORIGIN))).toBe(true);
    expect(result.every((item) => !/\/admin|\/checkout|\/api|\/dashboard|\/login/.test(item.url))).toBe(true);
  });

  it("uses canonical HTTPS product URLs and encodes product slug path segments", async () => {
    productFindMany.mockResolvedValue([{ slug: "test/product", updatedAt: new Date("2026-11-10") }]);
    const result = await sitemap();
    expect(result.at(-1)?.url).toBe("https://bkedigitalsolutions.com/products/test%2Fproduct");
  });

  it("generates Open Graph and Twitter cards from a fixed trusted canonical origin", () => {
    const metadata = publicPageMetadata({
      title: "Render Dock",
      description: "A BKE software product.",
      path: "/products/render-dock",
    });
    expect(metadata.alternates?.canonical).toBe("/products/render-dock");
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      url: "https://bkedigitalsolutions.com/products/render-dock",
      title: "Render Dock",
      description: "A BKE software product.",
      siteName: "BKE Digital Solutions",
      images: [{ url: PUBLIC_SHARE_IMAGE, alt: "Render Dock" }],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary",
      title: "Render Dock",
      images: [PUBLIC_SHARE_IMAGE],
    });
    expect(existsSync("public/bke-icon.png")).toBe(true);
  });

  it("preserves CMS-backed homepage titles while adding social cards and no private metadata leaks", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    const product = readFileSync("app/products/[slug]/page.tsx", "utf8");
    const catalog = readFileSync("app/products/page.tsx", "utf8");
    expect(layout).toContain("const content = await getSiteContent()");
    expect(layout).toContain("metadataBase: new URL(PUBLIC_SITE_ORIGIN)");
    expect(layout).toContain("siteName: content.siteName");
    expect(layout).toContain("description: content.heroDescription");
    expect(layout).toContain("card: \"summary\"");
    expect(product).toContain("export async function generateMetadata");
    expect(product).toContain("if (!product?.active || product.archivedAt !== null)");
    expect(product).toContain("robots: { index: false, follow: false }");
    expect(product).toContain("path: `/products/${encodeURIComponent(slug)}`");
    expect(catalog).toContain('path: "/products"');
    expect(catalog).toContain("publicPageMetadata");
    const all = [layout, product, catalog].join("\n");
    expect(all).not.toContain("PAYMONGO_SECRET_KEY");
    expect(all).not.toContain("DATABASE_URL:");
  });
});

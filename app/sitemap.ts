import type { MetadataRoute } from "next";
import { db } from "@/platform/host/db";
import { PUBLIC_SITE_ORIGIN, PUBLIC_SITEMAP_PATHS } from "@/apps/web/public-seo";

/** Build no sitemap from disposable/CI data: discover eligible products at request time. */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await db.product.findMany({
    where: { active: true, archivedAt: null },
    select: { slug: true, updatedAt: true },
    orderBy: { slug: "asc" },
  });

  const staticPages: MetadataRoute.Sitemap = PUBLIC_SITEMAP_PATHS.map((path) => ({
    url: new URL(path, PUBLIC_SITE_ORIGIN).toString(),
    changeFrequency: path === "/" ? ("weekly" as const) : ("monthly" as const),
    priority: path === "/" ? 1 : path === "/products" ? 0.9 : 0.5,
  }));

  return [
    ...staticPages,
    ...products.map((product) => ({
      url: new URL(`/products/${encodeURIComponent(product.slug)}`, PUBLIC_SITE_ORIGIN).toString(),
      lastModified: product.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}

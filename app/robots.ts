import type { MetadataRoute } from "next";
import { CRAWLER_EXCLUDED_PATHS, PUBLIC_SITE_ORIGIN } from "@/apps/web/public-seo";

/** Crawling hints only: authentication and authorization remain enforced server-side. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...CRAWLER_EXCLUDED_PATHS],
    },
    sitemap: `${PUBLIC_SITE_ORIGIN}/sitemap.xml`,
    host: PUBLIC_SITE_ORIGIN,
  };
}

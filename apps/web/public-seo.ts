import type { Metadata } from "next";

/** Public search and social canonical origin; never derive this from user-controlled Host headers. */
export const PUBLIC_SITE_ORIGIN = "https://bkedigitalsolutions.com";
export const PUBLIC_SHARE_IMAGE = "/bke-icon.png";

/** Only anonymous, supported storefront pages are eligible for sitemap inclusion. */
export const PUBLIC_SITEMAP_PATHS = [
  "/", "/products", "/licensing", "/bke",
  "/legal/privacy-policy", "/legal/terms-of-service",
] as const;

/** robots.txt is crawler guidance, NOT an authorization or data-protection boundary. */
export const CRAWLER_EXCLUDED_PATHS = [
  "/api/",
  "/admin",
  "/dashboard",
  "/auth/",
  "/checkout",
  "/device",
  "/login",
  "/register",
  "/redeem",
  "/support",
  "/security/",
  "/keys",
  "/claims",
  "/organizations",
  "/orders",
  "/subscriptions",
  "/licenses",
  "/legal/accept",
] as const;

export function publicPageMetadata({
  title,
  description,
  path,
  image = PUBLIC_SHARE_IMAGE,
}: {
  title: string;
  description: string;
  path: string;
  image?: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: new URL(path, PUBLIC_SITE_ORIGIN).toString(),
      title,
      description,
      siteName: "BKE Digital Solutions",
      locale: "en_PH",
      images: [{ url: image, alt: title }],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [image],
    },
  };
}

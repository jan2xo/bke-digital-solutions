import type { Metadata } from "next";
import "./globals.css";
import "./shared-surfaces.css";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { getSiteContent } from "@/apps/web/site-content";
import { PUBLIC_SHARE_IMAGE, PUBLIC_SITE_ORIGIN } from "@/apps/web/public-seo";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getSiteContent();
  return {
    metadataBase: new URL(PUBLIC_SITE_ORIGIN),
    title: { default: content.siteName, template: `%s | ${content.siteName}` },
    description: content.heroDescription,
    manifest: "/manifest.webmanifest",
    openGraph: {
      type: "website",
      locale: "en_PH",
      siteName: content.siteName,
      title: content.siteName,
      description: content.heroDescription,
      images: [{ url: PUBLIC_SHARE_IMAGE, alt: content.siteName }],
    },
    twitter: {
      card: "summary",
      title: content.siteName,
      description: content.heroDescription,
      images: [PUBLIC_SHARE_IMAGE],
    },
  };
}
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><Header/><main>{children}</main><Footer/></body></html>; }

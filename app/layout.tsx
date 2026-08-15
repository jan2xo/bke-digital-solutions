import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { getSiteContent } from "@/lib/site-content";

export async function generateMetadata(): Promise<Metadata> { const content = await getSiteContent(); return { title: { default: content.siteName, template: `%s | ${content.siteName}` }, description: content.heroDescription, icons: { icon: [{ url: "/bke-icon.png", type: "image/png" }, { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" }, { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" }], apple: "/apple-touch-icon.png" } }; }
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><Header/><main>{children}</main><Footer/></body></html>; }

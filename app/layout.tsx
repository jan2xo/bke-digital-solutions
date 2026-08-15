import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { getSiteContent } from "@/lib/site-content";

export async function generateMetadata(): Promise<Metadata> { const content = await getSiteContent(); return { title: { default: content.siteName, template: `%s | ${content.siteName}` }, description: content.heroDescription, manifest: "/manifest.webmanifest" }; }
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><Header/><main>{children}</main><Footer/></body></html>; }

import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

export const metadata: Metadata = { title: { default: "BKE Digital Solutions", template: "%s | BKE Digital Solutions" }, description: "Secure software products, subscriptions, and licenses for individuals and organizations." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><Header/><main>{children}</main><Footer/></body></html>; }

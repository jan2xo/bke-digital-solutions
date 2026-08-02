import { createHmac } from "node:crypto";
import { env } from "@/lib/env";

export function summarizeUserAgent(value: string | null | undefined) {
  if (!value) return "Unknown browser and device";
  const browser = value.includes("Edg/") ? "Edge" : value.includes("Chrome/") ? "Chrome" : value.includes("Safari/") ? "Safari" : value.includes("Firefox/") ? "Firefox" : "Browser";
  const os = value.includes("iPhone") || value.includes("iPad") ? "iOS" : value.includes("Mac OS X") ? "macOS" : value.includes("Windows") ? "Windows" : value.includes("Android") ? "Android" : value.includes("Linux") ? "Linux" : "unknown device";
  return `${browser} on ${os}`;
}

export function safeNetworkHint(ip: string) {
  if (!ip || ip === "unknown") return "Unknown network";
  return `Network ${createHmac("sha256", env.SESSION_SECRET).update(ip).digest("hex").slice(0, 8)}`;
}

import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const hashToken = (token: string) => createHmac("sha256", env.SESSION_SECRET).update(token).digest("hex");
export const hashLicenseKey = (key: string) => createHmac("sha256", env.LICENSE_PEPPER).update(key).digest("hex");

export function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function generateLicenseKey() {
  const body = randomBytes(20).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-");
  return `BKE-${body}`;
}

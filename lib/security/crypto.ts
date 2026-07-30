import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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
const encryptionKey = () => createHash("sha256").update(env.LICENSE_PEPPER).digest();
export function encryptLicenseKey(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}
export function decryptLicenseKey(value: string) {
  const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !encrypted) throw new Error("INVALID_CIPHERTEXT");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

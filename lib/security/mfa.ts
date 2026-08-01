import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const key = () => createHash("sha256").update(env.MFA_ENCRYPTION_KEY ?? env.SESSION_SECRET).digest();

export function base32Encode(input: Buffer) {
  let bits = "";
  for (const byte of input) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let i = 0; i < bits.length; i += 5) output += alphabet[Number.parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return output;
}

function base32Decode(value: string) {
  let bits = "";
  for (const char of value.replace(/=|\s|-/g, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("INVALID_MFA_SECRET");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export const generateTotpSecret = () => base32Encode(randomBytes(20));
export const totpUri = (email: string, secret: string) => `otpauth://totp/${encodeURIComponent(`BKE Digital Solutions:${email}`)}?secret=${secret}&issuer=${encodeURIComponent("BKE Digital Solutions")}&algorithm=SHA1&digits=6&period=30`;

function totp(secret: string, counter: number) {
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, "0");
}
export const generateTotpCode = (secret: string, now = Date.now()) => totp(secret, Math.floor(now / 30_000));

export function verifyTotp(secret: string, candidate: string, now = Date.now()) {
  if (!/^\d{6}$/.test(candidate)) return false;
  const counter = Math.floor(now / 30_000);
  return [-1, 0, 1].some((window) => timingSafeEqual(Buffer.from(totp(secret, counter + window)), Buffer.from(candidate)));
}

export function encryptMfaSecret(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptMfaSecret(value: string) {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("INVALID_MFA_CIPHERTEXT");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => base32Encode(randomBytes(10)).match(/.{1,5}/g)!.join("-"));
}
export const normalizeRecoveryCode = (code: string) => code.replace(/[^A-Z2-7]/gi, "").toUpperCase();
export const hashRecoveryCode = (code: string) => createHmac("sha256", key()).update(normalizeRecoveryCode(code)).digest("hex");

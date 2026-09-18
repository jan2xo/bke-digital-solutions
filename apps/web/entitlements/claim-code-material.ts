import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const CLAIM_CODE_PATTERN = /^BKE-CLM-(?:[A-F0-9]{5}-){5}[A-F0-9]{5}$/;

export function normalizeClaimCode(value: string): string {
  return value.trim().toUpperCase();
}

export function validClaimCode(value: string): boolean {
  return CLAIM_CODE_PATTERN.test(normalizeClaimCode(value));
}

export function generateClaimCode(): string {
  const body = randomBytes(15).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-");
  return `BKE-CLM-${body}`;
}

export function hashClaimCode(value: string, pepper: string): string {
  const normalized = normalizeClaimCode(value);
  if (!CLAIM_CODE_PATTERN.test(normalized)) {
    throw new Error("INVALID_CLAIM_CODE");
  }
  const secret = pepper.trim();
  if (!secret) throw new Error("CLAIM_CODE_PEPPER_REQUIRED");
  return createHmac("sha256", secret).update(normalized).digest("hex");
}

const claimEncryptionKey = (secret: string) => {
  const normalized = secret.trim();
  if (normalized.length < 32) throw new Error("CLAIM_CODE_ENCRYPTION_KEY_REQUIRED");
  return createHash("sha256")
    .update("bke-claim-code-encryption-v1\0", "utf8")
    .update(normalized, "utf8")
    .digest();
};

export function encryptClaimCode(value: string, secret: string): string {
  const normalized = normalizeClaimCode(value);
  if (!CLAIM_CODE_PATTERN.test(normalized)) throw new Error("INVALID_CLAIM_CODE");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", claimEncryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), encrypted]
    .map((part) => typeof part === "string" ? part : part.toString("base64url"))
    .join(".");
}

export function decryptClaimCode(value: string, secret: string): string {
  const [version, ivText, tagText, ciphertextText, extra] = value.split(".");
  if (version !== "v1" || !ivText || !tagText || !ciphertextText || extra !== undefined) {
    throw new Error("INVALID_CLAIM_CODE_CIPHERTEXT");
  }
  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  const ciphertext = Buffer.from(ciphertextText, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error("INVALID_CLAIM_CODE_CIPHERTEXT");
  }
  const decipher = createDecipheriv("aes-256-gcm", claimEncryptionKey(secret), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const normalized = normalizeClaimCode(plaintext);
  if (!CLAIM_CODE_PATTERN.test(normalized)) throw new Error("INVALID_CLAIM_CODE_CIPHERTEXT");
  return normalized;
}

import { createHmac, randomBytes } from "node:crypto";

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

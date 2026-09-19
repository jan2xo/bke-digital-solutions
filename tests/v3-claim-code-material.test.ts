import { describe, expect, it } from "vitest";
import {
  decryptClaimCode,
  encryptClaimCode,
  generateClaimCode,
  hashClaimCode,
  normalizeClaimCode,
  validClaimCode,
} from "@/apps/web/entitlements/claim-code-material";

describe("V3 Claim Code material", () => {
  it("generates a high-entropy BKE claim code in the canonical format", () => {
    const code = generateClaimCode();
    expect(code).toMatch(/^BKE-CLM-(?:[A-F0-9]{5}-){5}[A-F0-9]{5}$/);
    expect(validClaimCode(code)).toBe(true);
  });

  it("normalizes case without changing claim identity", () => {
    const code = generateClaimCode();
    const lower = code.toLowerCase();
    expect(normalizeClaimCode(lower)).toBe(code);
    expect(hashClaimCode(lower, "test-pepper")).toBe(hashClaimCode(code, "test-pepper"));
  });

  it("never accepts legacy runtime license keys as claim codes", () => {
    expect(validClaimCode("BKE-ABCDE-ABCDE-ABCDE-ABCDE")).toBe(false);
  });

  it("separates claim-code hashes by secret pepper", () => {
    const code = generateClaimCode();
    expect(hashClaimCode(code, "pepper-a")).not.toBe(hashClaimCode(code, "pepper-b"));
  });

  it("encrypts reveal material and round-trips only with the correct delivery key", () => {
    const code = generateClaimCode();
    const key = "claim-delivery-key-with-more-than-thirty-two-characters";
    const encrypted = encryptClaimCode(code, key);
    expect(encrypted).not.toContain(code);
    expect(decryptClaimCode(encrypted, key)).toBe(code);
    expect(() => decryptClaimCode(encrypted, "another-valid-delivery-key-with-enough-characters")).toThrow();
  });

  it("rejects malformed encrypted delivery material", () => {
    const key = "claim-delivery-key-with-more-than-thirty-two-characters";
    expect(() => decryptClaimCode("v1.bad.bad.bad", key)).toThrow("INVALID_CLAIM_CODE_CIPHERTEXT");
  });
});

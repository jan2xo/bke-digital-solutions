import { describe, expect, it } from "vitest";
import { decryptProviderCredential, encryptProviderCredential, providerCredentialHint } from "@/lib/provider-config/crypto";

describe("external provider credential encryption", () => {
  const key = "provider-master-key-material-that-is-long-enough-for-testing";

  it("round trips with authenticated encryption and a versioned envelope", () => {
    const encrypted = encryptProviderCredential("sk_test_secret", key, 3);
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("sk_test_secret");
    expect(decryptProviderCredential(encrypted, key, 3)).toBe("sk_test_secret");
  });

  it("uses a fresh nonce for every write", () => {
    expect(encryptProviderCredential("same", key, 1)).not.toBe(encryptProviderCredential("same", key, 1));
  });

  it("fails closed for the wrong key or key version", () => {
    const encrypted = encryptProviderCredential("re_secret", key, 2);
    expect(() => decryptProviderCredential(encrypted, "different-master-key-material-that-is-also-long-enough", 2)).toThrow("PROVIDER_CREDENTIAL_DECRYPT_FAILED");
    expect(() => decryptProviderCredential(encrypted, key, 1)).toThrow("PROVIDER_CREDENTIAL_DECRYPT_FAILED");
  });

  it("exposes only a small non-sensitive hint", () => {
    expect(providerCredentialHint("synthetic_test_abcdefghijklmnopqrstuvwxyz")).toBe("synt••••wxyz");
    expect(providerCredentialHint("short")).toBe("••••");
  });
});

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const deriveKey = (material: string) =>
  createHash("sha256").update(material, "utf8").digest();
const aad = (version: number) =>
  Buffer.from(`bke-provider-credential:v${version}`, "utf8");

export function encryptProviderCredential(
  plaintext: string,
  material: string,
  keyVersion: number,
): string {
  if (!material || material.length < 32 || keyVersion < 1) {
    throw new Error("PROVIDER_SOURCE_UNAVAILABLE");
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(material), nonce);
  cipher.setAAD(aad(keyVersion));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return `v1.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptProviderCredential(
  value: string,
  material: string,
  keyVersion: number,
): string {
  try {
    const [format, nonce, tag, ciphertext] = value.split(".");
    if (format !== "v1" || !nonce || !tag || !ciphertext) throw new Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(material),
      Buffer.from(nonce, "base64url"),
    );
    decipher.setAAD(aad(keyVersion));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("PROVIDER_CREDENTIAL_DECRYPT_FAILED");
  }
}

export function providerCredentialHint(value: string): string {
  const compact = value.trim();
  if (compact.length < 9) return "••••";
  return `${compact.slice(0, 4)}••••${compact.slice(-4)}`;
}

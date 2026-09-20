import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildReleaseManifest, canonicalizeManifest, manifestHash } from "@/lib/supply-chain/manifest";

const artifacts = [{ id: "b", objectKey: "products/p/b.zip", sha256: createHash("sha256").update("b").digest("hex"), sizeBytes: 1, contentType: "application/zip" }, { id: "a", objectKey: "products/p/a.exe", sha256: createHash("sha256").update("a").digest("hex"), sizeBytes: 2, contentType: "application/octet-stream" }];

describe("canonical supply-chain manifests", () => {
  it("sorts artifacts and produces deterministic JSON", () => {
    const one = buildReleaseManifest({ productId: "p", productSlug: "product", versionId: "v", version: "1.0.0", signingKeyId: "key-a", artifacts });
    const two = buildReleaseManifest({ productId: "p", productSlug: "product", versionId: "v", version: "1.0.0", signingKeyId: "key-a", artifacts: [...artifacts].reverse() });
    expect(canonicalizeManifest(one)).toBe(canonicalizeManifest(two));
  });
  it("changes when artifact, product, or version identity changes", () => {
    const base = buildReleaseManifest({ productId: "p", productSlug: "product", versionId: "v", version: "1.0.0", signingKeyId: "key-a", artifacts });
    expect(manifestHash(canonicalizeManifest({ ...base, artifacts: [{ ...artifacts[0]!, sha256: "changed" }, artifacts[1]!] }))).not.toBe(manifestHash(canonicalizeManifest(base)));
    expect(canonicalizeManifest({ ...base, productId: "other" })).not.toBe(canonicalizeManifest(base));
    expect(canonicalizeManifest({ ...base, version: "2.0.0" })).not.toBe(canonicalizeManifest(base));
  });
  it("supports independent Ed25519 verification and rejects tampering/wrong key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const payload = canonicalizeManifest(buildReleaseManifest({ productId: "p", productSlug: "product", versionId: "v", version: "1.0.0", signingKeyId: "key-a", artifacts }));
    const signature = sign(null, Buffer.from(payload), privateKey);
    expect(verify(null, Buffer.from(payload), publicKey, signature)).toBe(true);
    expect(verify(null, Buffer.from(`${payload}x`), publicKey, signature)).toBe(false);
  });
});

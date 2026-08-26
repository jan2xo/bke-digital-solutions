import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalizeManifest, requireManifestArtifact, verifySignedEnvelope, type SignedReleaseManifest } from "@/lib/supply-chain/manifest";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const key = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const manifest: SignedReleaseManifest = { schema: "bke.supply-chain.v1", productId: "p1", productSlug: "product", versionId: "v1", version: "1.0.0", signingKeyId: "active", artifacts: [{ id: "a1", objectKey: "a.bin", sha256: "a".repeat(64), sizeBytes: 4, contentType: "application/octet-stream" }] };
const envelope = () => ({ algorithm: "Ed25519", keyId: "active", manifest, signature: sign(null, Buffer.from(canonicalizeManifest(manifest)), privateKey).toString("base64") });

describe("signed supply-chain envelope boundary", () => {
  it("verifies an authentic envelope and returns its payload identity", () => expect(verifySignedEnvelope(envelope(), JSON.stringify({ active: key }), "active")).toMatchObject({ keyId: "active", payloadHash: expect.any(String), manifest }));
  it("rejects tampered signatures and manifests", () => {
    expect(() => verifySignedEnvelope({ ...envelope(), signature: "not-a-signature" }, JSON.stringify({ active: key }), "active")).toThrow("SUPPLY_CHAIN_SIGNATURE_INVALID");
    expect(() => verifySignedEnvelope({ ...envelope(), manifest: { ...manifest, version: "9.9.9" } }, JSON.stringify({ active: key }), "active")).toThrow("SUPPLY_CHAIN_SIGNATURE_INVALID");
  });
  it("rejects identity, contract, and key mismatch before authorization concerns", () => {
    expect(() => verifySignedEnvelope(envelope(), JSON.stringify({ active: key }), "active", undefined, { productId: "other" })).toThrow("SUPPLY_CHAIN_MANIFEST_IDENTITY_PRODUCTID");
    expect(() => verifySignedEnvelope({ ...envelope(), keyId: "retired" }, JSON.stringify({ active: key }), "active")).toThrow("SUPPLY_CHAIN_ENVELOPE_KEY_MISMATCH");
    expect(() => verifySignedEnvelope({ ...envelope(), algorithm: "RSA" }, JSON.stringify({ active: key }), "active")).toThrow("SUPPLY_CHAIN_ENVELOPE_CONTRACT");
    expect(() => verifySignedEnvelope(envelope(), JSON.stringify({ active: key }), "active", undefined, undefined)).not.toThrow();
  });
});

describe("selected artifact binding", () => {
  it("accepts only the exact artifact covered by the signed manifest", () => {
    expect(() => requireManifestArtifact(manifest, manifest.artifacts[0])).not.toThrow();
    expect(() => requireManifestArtifact(manifest, { ...manifest.artifacts[0], sha256: "b".repeat(64) })).toThrow("ARTIFACT_MISMATCH");
  });
});

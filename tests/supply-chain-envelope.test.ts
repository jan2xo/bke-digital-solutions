import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalizeManifest, requireManifestArtifact, verifySignedEnvelope, type SignedReleaseManifest } from "@/lib/supply-chain/manifest";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const key = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const manifest: SignedReleaseManifest = {
  schema: "bke.supply-chain.v1",
  productId: "p1",
  productSlug: "product",
  versionId: "v1",
  version: "1.0.0",
  signingKeyId: "active",
  artifacts: [
    { id: "installer", objectKey: "installer.exe", sha256: "a".repeat(64), sizeBytes: 4, contentType: "application/vnd.microsoft.portable-executable" },
    { id: "updater", objectKey: "update.zip", sha256: "b".repeat(64), sizeBytes: 8, contentType: "application/vnd.bke.update-package+zip" },
  ],
};
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
  it("accepts an exact selected artifact within a multi-artifact signed manifest", () => {
    const updater = manifest.artifacts[1];
    expect(() => requireManifestArtifact(manifest, updater)).not.toThrow();
    expect(() => requireManifestArtifact(manifest, { ...updater, sha256: "c".repeat(64) })).toThrow("ARTIFACT_MISMATCH");
    expect(() => requireManifestArtifact(manifest, { ...updater, id: "missing" })).toThrow("ARTIFACT_MISMATCH");
  });
});

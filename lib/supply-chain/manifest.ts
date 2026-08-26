import "server-only";
import { createHash, createPublicKey, verify } from "node:crypto";
import { resolveTrustedSupplyChainKey } from "@/lib/supply-chain/keyring";

export type SignedArtifact = { id: string; objectKey: string; sha256: string; sizeBytes: number; contentType: string };
export type SignedReleaseManifest = { schema: "bke.supply-chain.v1"; productId: string; productSlug: string; versionId: string; version: string; signingKeyId: string; artifacts: SignedArtifact[] };
export type SignedEnvelope = { algorithm: "Ed25519"; keyId: string; manifest: unknown; signature: string };

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordered(v)]));
  return value;
}

export function canonicalizeManifest(manifest: SignedReleaseManifest): string { return JSON.stringify(ordered(manifest)); }
export function manifestHash(serialized: string): string { return createHash("sha256").update(serialized).digest("hex"); }
export function buildReleaseManifest(input: Omit<SignedReleaseManifest, "schema" | "artifacts"> & { artifacts: SignedArtifact[] }): SignedReleaseManifest {
  return { schema: "bke.supply-chain.v1", productId: input.productId, productSlug: input.productSlug, versionId: input.versionId, version: input.version, signingKeyId: input.signingKeyId, artifacts: [...input.artifacts].sort((a, b) => a.id.localeCompare(b.id)) };
}

function invalid(reason: string): never { throw new Error(`SUPPLY_CHAIN_MANIFEST_${reason}`); }
function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) invalid(`INVALID_${field.toUpperCase()}`);
}

/** Runtime validation is deliberately independent of authorization or database policy. */
export function validateReleaseManifest(input: unknown, expected?: Partial<Pick<SignedReleaseManifest, "productId" | "productSlug" | "versionId" | "version">>): SignedReleaseManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("INVALID_SHAPE");
  const value = input as Record<string, unknown>;
  if (value.schema !== "bke.supply-chain.v1") invalid("IDENTITY");
  for (const field of ["productId", "productSlug", "versionId", "version", "signingKeyId"] as const) text(value[field], field);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(value.signingKeyId as string)) invalid("SIGNING_KEY_ID");
  if (!Array.isArray(value.artifacts)) invalid("ARTIFACTS");
  const ids = new Set<string>();
  const artifacts = value.artifacts.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid("ARTIFACT");
    const artifact = raw as Record<string, unknown>;
    text(artifact.id, "artifact_id"); text(artifact.objectKey, "object_key"); text(artifact.sha256, "sha256"); text(artifact.contentType, "content_type");
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256 as string) || !Number.isSafeInteger(artifact.sizeBytes) || (artifact.sizeBytes as number) < 0 || ids.has(artifact.id as string)) invalid("ARTIFACT_CONTRACT");
    ids.add(artifact.id as string);
    return { id: artifact.id as string, objectKey: artifact.objectKey as string, sha256: artifact.sha256 as string, sizeBytes: artifact.sizeBytes as number, contentType: artifact.contentType as string };
  });
  for (const field of ["productId", "productSlug", "versionId", "version"] as const) if (expected?.[field] !== undefined && value[field] !== expected[field]) invalid(`IDENTITY_${field.toUpperCase()}`);
  return { schema: "bke.supply-chain.v1", productId: value.productId as string, productSlug: value.productSlug as string, versionId: value.versionId as string, version: value.version as string, signingKeyId: value.signingKeyId as string, artifacts };
}

/** Verifies only authenticity and manifest contract. It does not grant access or authorize an Agent. */
export function verifySignedEnvelope(envelope: unknown, keyringRaw: string | undefined, activeKeyId: string, fallbackPublicKey?: string, expected?: Partial<Pick<SignedReleaseManifest, "productId" | "productSlug" | "versionId" | "version">>): { manifest: SignedReleaseManifest; payloadHash: string; keyId: string } {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error("SUPPLY_CHAIN_ENVELOPE_INVALID");
  const value = envelope as Record<string, unknown>;
  if (value.algorithm !== "Ed25519" || typeof value.signature !== "string" || !value.signature || typeof value.keyId !== "string") throw new Error("SUPPLY_CHAIN_ENVELOPE_CONTRACT");
  const manifest = validateReleaseManifest(value.manifest, expected);
  if (manifest.signingKeyId !== value.keyId) throw new Error("SUPPLY_CHAIN_ENVELOPE_KEY_MISMATCH");
  const resolved = resolveTrustedSupplyChainKey(keyringRaw, activeKeyId, fallbackPublicKey, value.keyId);
  try {
    const raw = resolved.key.includes("BEGIN") ? createPublicKey(resolved.key) : createPublicKey({ key: Buffer.from(resolved.key, "base64"), format: "der", type: "spki" });
    const payload = canonicalizeManifest(manifest);
    if (!verify(null, Buffer.from(payload), raw, Buffer.from(value.signature, "base64"))) throw new Error("SUPPLY_CHAIN_SIGNATURE_INVALID");
    return { manifest, payloadHash: manifestHash(payload), keyId: resolved.keyId };
  } catch (error) { if (error instanceof Error && error.message.startsWith("SUPPLY_CHAIN_")) throw error; throw new Error("SUPPLY_CHAIN_KEY_INVALID"); }
}

export function requireManifestArtifact(manifest: SignedReleaseManifest, artifact: SignedArtifact): void {
  if (manifest.artifacts.length !== 1) throw new Error("SUPPLY_CHAIN_MANIFEST_ARTIFACT_SELECTION");
  const signed = manifest.artifacts[0];
  if (signed.id !== artifact.id || signed.objectKey !== artifact.objectKey ||
      signed.sha256 !== artifact.sha256.toLowerCase() || signed.sizeBytes !== artifact.sizeBytes ||
      signed.contentType !== artifact.contentType) {
    throw new Error("SUPPLY_CHAIN_MANIFEST_ARTIFACT_MISMATCH");
  }
}

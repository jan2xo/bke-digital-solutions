import "server-only";
import { createHash } from "node:crypto";

export type SignedArtifact = { id: string; objectKey: string; sha256: string; sizeBytes: number; contentType: string };
export type SignedReleaseManifest = { schema: "bke.supply-chain.v1"; productId: string; productSlug: string; versionId: string; version: string; signingKeyId: string; artifacts: SignedArtifact[] };

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

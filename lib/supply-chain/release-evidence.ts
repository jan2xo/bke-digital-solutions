import "server-only";
import { timingSafeEqual, createHash } from "node:crypto";
import { z } from "zod";
import { validateTechnicalEvidence } from "@/lib/supply-chain/technical-evidence";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const artifact = z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(512), objectKey: z.string().min(1).max(1024), contentType: z.string().min(1).max(255), sizeBytes: z.number().int().nonnegative(), sha256, bytesBase64: z.string().min(1) });
const evidence = z.object({ kind: z.enum(["SBOM", "PROVENANCE", "DEPENDENCIES", "MIGRATION"]), reference: z.string().min(1).max(512), documentBase64: z.string().min(1), documentSha256: sha256 });
export const releaseEvidenceEnvelopeSchema = z.object({ schema: z.literal("bke.release-evidence.v1"), productId: z.string().min(1), version: z.string().min(1), sourceSha: z.string().regex(/^[a-f0-9]{40}$/), manifestSha256: sha256, manifest: z.record(z.string(), z.unknown()), artifacts: z.array(artifact).min(1), evidence: z.array(evidence).min(4), producer: z.object({ repository: z.string().min(1), workflow: z.string().min(1), runId: z.string().min(1) }) });
export type ReleaseEvidenceEnvelope = z.infer<typeof releaseEvidenceEnvelopeSchema>;

export function bearerMatches(header: string | null, expected: string | undefined): boolean {
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7)); const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function validateReleaseEvidence(input: unknown): ReleaseEvidenceEnvelope {
  const value = releaseEvidenceEnvelopeSchema.parse(input);
  const manifestBytes = Buffer.from(JSON.stringify(value.manifest));
  if (createHash("sha256").update(manifestBytes).digest("hex") !== value.manifestSha256) throw new Error("MANIFEST_SHA_MISMATCH");
  const seen = new Set<string>();
  for (const item of value.artifacts) {
    if (seen.has(item.id)) throw new Error("DUPLICATE_ARTIFACT"); seen.add(item.id);
    const bytes = Buffer.from(item.bytesBase64, "base64");
    if (bytes.length !== item.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw new Error("ARTIFACT_HASH_MISMATCH");
  }
  const kinds = new Set<string>();
  for (const item of value.evidence) {
    if (kinds.has(item.kind)) throw new Error("CONFLICTING_EVIDENCE"); kinds.add(item.kind);
    const bytes = Buffer.from(item.documentBase64, "base64");
    if (createHash("sha256").update(bytes).digest("hex") !== item.documentSha256) throw new Error("EVIDENCE_HASH_MISMATCH");
    if (item.kind !== "MIGRATION") validateTechnicalEvidence(item.kind, bytes, value.version);
    else if (!/database schema is up to date/i.test(bytes.toString("utf8"))) throw new Error("MIGRATION_EVIDENCE_NOT_CURRENT");
  }
  for (const kind of ["SBOM", "PROVENANCE", "DEPENDENCIES", "MIGRATION"]) if (!kinds.has(kind)) throw new Error("MISSING_EVIDENCE");
  return value;
}

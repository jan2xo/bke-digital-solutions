import { z } from "zod";

const schema = z.object({
  format: z.literal("bke.compliance-certification.v1"),
  classification: z.enum(["COMMERCIAL", "MOCK"]),
  versionId: z.string().min(1),
  releaseVersion: z.string().min(1).optional(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  scope: z.string().trim().min(1).max(2000),
  legalDocuments: z.array(z.object({ type: z.string().min(1), versionId: z.string().min(1), contentHash: z.string().regex(/^[a-f0-9]{64}$/) })).min(1),
  assertions: z.object({ legalReviewed: z.boolean(), privacyReviewed: z.boolean(), taxReviewed: z.boolean(), retentionDecided: z.boolean() }),
  reviewers: z.array(z.object({ role: z.string().min(1), identity: z.string().min(1) })).min(1),
  certifyingAdmin: z.object({ id: z.string().min(1) }).optional(),
  notes: z.string().nullable().optional(),
  certifiedAt: z.string().datetime(),
}).strict();

export type ComplianceCertification = z.infer<typeof schema>;

export function complianceLegalReferencesCurrent(metadata: unknown, current: Array<{ type: string; versionId: string; contentHash: string }>) {
  if (!metadata || typeof metadata !== "object") return false;
  const documents = (metadata as { legalDocuments?: unknown }).legalDocuments;
  if (!Array.isArray(documents) || documents.length !== current.length) return false;
  return current.every((required) => documents.some((item) => {
    if (!item || typeof item !== "object") return false;
    const document = item as Record<string, unknown>;
    return document.type === required.type && document.versionId === required.versionId && document.contentHash === required.contentHash;
  }));
}

export function isCommercialComplianceEvidence(item: { kind: string; result: string; artifactHash: string; metadata: unknown }, versionId: string, payloadHash: string) {
  if (item.kind !== "COMPLIANCE" || item.result !== "VERIFIED" || item.artifactHash !== payloadHash || !item.metadata || typeof item.metadata !== "object") return false;
  const metadata = item.metadata as Record<string, unknown>;
  return metadata.format === "bke.compliance-certification.v1" && metadata.classification === "COMMERCIAL" && metadata.versionId === versionId && metadata.payloadHash === payloadHash && Array.isArray(metadata.legalDocuments) && Array.isArray(metadata.reviewers) && metadata.assertions && typeof metadata.assertions === "object" && Object.values(metadata.assertions as Record<string, unknown>).every((value) => value === true);
}

export function validateComplianceCertification(document: Buffer, versionId: string, payloadHash: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(document.toString("utf8")); } catch { throw new Error("COMPLIANCE_EVIDENCE_INVALID"); }
  const result = schema.safeParse(parsed);
  if (!result.success || result.data.versionId !== versionId || result.data.payloadHash !== payloadHash) throw new Error("COMPLIANCE_EVIDENCE_INVALID");
  if (result.data.classification === "COMMERCIAL" && (!result.data.assertions.legalReviewed || !result.data.assertions.privacyReviewed || !result.data.assertions.taxReviewed || !result.data.assertions.retentionDecided)) throw new Error("COMPLIANCE_ASSERTIONS_INCOMPLETE");
  return result.data;
}

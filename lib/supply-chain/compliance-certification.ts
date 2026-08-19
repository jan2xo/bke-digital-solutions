import { z } from "zod";

const schema = z.object({
  format: z.literal("bke.compliance-certification.v1"),
  classification: z.enum(["COMMERCIAL", "MOCK"]),
  versionId: z.string().min(1),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  scope: z.string().trim().min(1).max(2000),
  legalDocuments: z.array(z.object({ type: z.string().min(1), versionId: z.string().min(1), contentHash: z.string().regex(/^[a-f0-9]{64}$/) })).min(1),
  assertions: z.object({ legalReviewed: z.boolean(), privacyReviewed: z.boolean(), taxReviewed: z.boolean(), retentionDecided: z.boolean() }),
  reviewers: z.array(z.object({ role: z.string().min(1), identity: z.string().min(1) })).min(1),
  certifiedAt: z.string().datetime(),
}).strict();

export function validateComplianceCertification(document: Buffer, versionId: string, payloadHash: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(document.toString("utf8")); } catch { throw new Error("COMPLIANCE_EVIDENCE_INVALID"); }
  const result = schema.safeParse(parsed);
  if (!result.success || result.data.versionId !== versionId || result.data.payloadHash !== payloadHash) throw new Error("COMPLIANCE_EVIDENCE_INVALID");
  if (result.data.classification === "COMMERCIAL" && (!result.data.assertions.legalReviewed || !result.data.assertions.privacyReviewed || !result.data.assertions.taxReviewed || !result.data.assertions.retentionDecided)) throw new Error("COMPLIANCE_ASSERTIONS_INCOMPLETE");
  return result.data;
}

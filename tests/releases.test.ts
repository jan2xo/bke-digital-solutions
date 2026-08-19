import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { isCustomerReleaseEligible } from "@/lib/releases/eligibility";
import { releaseReadiness } from "@/lib/supply-chain/readiness";
import { currentApproval } from "@/lib/releases/approval";
import { isCommercialComplianceEvidence, validateComplianceCertification } from "@/lib/supply-chain/compliance-certification";

vi.mock("@/lib/env", () => ({ env: { SUPPLY_CHAIN_SIGNING_KEY_ID: "supply-test" } }));

describe("customer release eligibility", () => {
  it("keeps drafts and unpublished versions out of the customer release set", () => {
    expect(isCustomerReleaseEligible({ lifecycle: "DRAFT", active: true, publishedAt: new Date() })).toBe(false);
    expect(isCustomerReleaseEligible({ lifecycle: "STABLE", active: true, publishedAt: null })).toBe(false);
  });

  it("accepts published active stable and LTS versions", () => {
    expect(isCustomerReleaseEligible({ lifecycle: "STABLE", active: true, publishedAt: new Date() })).toBe(true);
    expect(isCustomerReleaseEligible({ lifecycle: "LTS", active: true, publishedAt: new Date() })).toBe(true);
  });

  it("does not treat inactive releases as downloadable", () => {
    expect(isCustomerReleaseEligible({ lifecycle: "STABLE", active: false, publishedAt: new Date() })).toBe(false);
  });

  it("requires trusted publication readiness in the artifact download resolver", () => {
    const readiness = releaseReadiness({
      id: "version-1",
      productId: "product-1",
      version: "1.0.0",
      product: { slug: "product" },
      artifacts: [{ id: "artifact-1", objectKey: "artifacts/a.bin", sha256: "a".repeat(64), sizeBytes: 1n, contentType: "application/octet-stream" }],
      supplyChainEvidence: null,
      backupEvidence: null,
      complianceEvidence: null,
      migrationEvidence: null,
      approvals: [],
    });
    expect(readiness.publishable).toBe(false);
    expect(readiness.items.filter((item) => item.status === "BLOCKED").map((item) => item.key)).toEqual(expect.arrayContaining(["signature", "malware", "sbom", "provenance"]));
  });

  it("rejects SBOM and provenance fields without current hash-bound evidence", () => {
    const readiness = releaseReadiness({
      id: "version-2", productId: "product-1", version: "1.0.1", product: { slug: "product" },
      artifacts: [{ id: "artifact-1", objectKey: "artifacts/a.bin", sha256: "a".repeat(64), sizeBytes: 1n, contentType: "application/octet-stream" }],
      supplyChainEvidence: { signatureVerified: true, signatureKeyId: "supply-test", sbomReference: "sbom.json", provenanceStatus: "VERIFIED", dependencyVerified: true, malwareStatus: "CLEAN", verificationEvidence: [
        { kind: "SIGNATURE", result: "VERIFIED", artifactHash: "old".repeat(16), metadata: {} },
        { kind: "SBOM", result: "VERIFIED", artifactHash: "old".repeat(16), metadata: {} },
        { kind: "PROVENANCE", result: "VERIFIED", artifactHash: "old".repeat(16), metadata: {} },
      ] },
      backupEvidence: "backup", complianceEvidence: "compliance", migrationEvidence: "migration", approvals: [{ approvedAt: new Date(), reviewedById: "reviewer" }],
    });
    expect(readiness.publishable).toBe(false);
    expect(readiness.items.filter((item) => item.key === "sbom" || item.key === "provenance").every((item) => item.status === "BLOCKED")).toBe(true);
  });

  it("accepts only a separated review and approval for the current payload", () => {
    const payloadHash = "a".repeat(64);
    const valid = currentApproval([{ payloadHash, createdById: "reviewer", reviewedById: "reviewer", reviewedAt: new Date(), approvedById: "approver", approvedAt: new Date() }], payloadHash);
    expect(valid.valid).toBe(true);
    expect(currentApproval([{ payloadHash, createdById: "reviewer", reviewedById: "reviewer", reviewedAt: new Date(), approvedById: "reviewer", approvedAt: new Date() }], payloadHash).valid).toBe(false);
    expect(currentApproval([{ payloadHash: "b".repeat(64), createdById: "reviewer", reviewedById: "reviewer", reviewedAt: new Date(), approvedById: "approver", approvedAt: new Date() }], payloadHash).valid).toBe(false);
  });

  it("requires structured commercial compliance and rejects mock or arbitrary bytes", () => {
    const payloadHash = "a".repeat(64);
    const base = { format: "bke.compliance-certification.v1", versionId: "version-1", payloadHash, scope: "release", legalDocuments: [{ type: "TERMS_OF_SERVICE", versionId: "legal-1", contentHash: "b".repeat(64) }], assertions: { legalReviewed: true, privacyReviewed: true, taxReviewed: true, retentionDecided: true }, reviewers: [{ role: "legal", identity: "counsel" }], certifiedAt: "2026-08-19T00:00:00.000Z" };
    expect(() => validateComplianceCertification(Buffer.from("not-json"), "version-1", payloadHash)).toThrow("COMPLIANCE_EVIDENCE_INVALID");
    expect(() => validateComplianceCertification(Buffer.from(JSON.stringify({ ...base, classification: "MOCK" })), "version-1", payloadHash)).not.toThrow();
    expect(validateComplianceCertification(Buffer.from(JSON.stringify({ ...base, classification: "COMMERCIAL" })), "version-1", payloadHash).classification).toBe("COMMERCIAL");
    expect(isCommercialComplianceEvidence({ kind: "COMPLIANCE", result: "VERIFIED", artifactHash: payloadHash, metadata: { ...base, classification: "MOCK" } }, "version-1", payloadHash)).toBe(false);
    expect(isCommercialComplianceEvidence({ kind: "COMPLIANCE", result: "VERIFIED", artifactHash: payloadHash, metadata: { ...base, classification: "COMMERCIAL" } }, "version-1", payloadHash)).toBe(true);
    expect(isCommercialComplianceEvidence({ kind: "COMPLIANCE", result: "VERIFIED", artifactHash: payloadHash, metadata: { reference: "Codex Image Aug 18, 2026, 03_53_39 PM.png" } }, "version-1", payloadHash)).toBe(false);
  });

  it("does not let legacy current-hash compliance rows satisfy readiness", () => {
    const version = { id: "version-legacy", productId: "product-1", version: "1.0.0", product: { slug: "product" }, artifacts: [{ id: "artifact-1", objectKey: "artifacts/a.bin", sha256: "a".repeat(64), sizeBytes: 1n, contentType: "application/octet-stream" }], supplyChainEvidence: { signatureVerified: false, signatureKeyId: null, sbomReference: null, provenanceStatus: "RECORDED", dependencyVerified: false, malwareStatus: "PENDING_SCAN", verificationEvidence: [{ kind: "COMPLIANCE", result: "VERIFIED", artifactHash: "0".repeat(64), metadata: { reference: "Codex Image Aug 18, 2026, 03_53_39 PM.png" } }] }, backupEvidence: null, complianceEvidence: "Codex Image Aug 18, 2026, 03_53_39 PM.png", migrationEvidence: null, approvals: [] };
    expect(releaseReadiness(version).items.find((item) => item.key === "compliance")?.status).toBe("BLOCKED");
  });
});

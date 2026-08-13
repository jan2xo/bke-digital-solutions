import { describe, expect, it } from "vitest";
import { evaluateReleaseGate } from "@/lib/releases/release-gate";

const complete = {
  signatureVerified: true, dependenciesVerified: true, sbomPresent: true,
  provenanceVerified: true, malwareClean: true, backupEvidencePresent: true,
  complianceEvidencePresent: true, migrationEvidencePresent: true,
  pendingComplianceCount: 0, reviewedById: "reviewer", priorCreatedById: "author",
  approvingAdminId: "approver",
};

describe("repository release gate", () => {
  it("passes only when all evidence and approval checks are present", () => {
    const result = evaluateReleaseGate(complete);
    expect(result.ready).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("reports missing evidence instead of producing a vague failure", () => {
    const result = evaluateReleaseGate({ ...complete, malwareClean: false, sbomPresent: false, pendingComplianceCount: 1 });
    expect(result.ready).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining(["malware", "sbom", "compliance"]));
  });

  it("enforces reviewer and approver separation", () => {
    const result = evaluateReleaseGate({ ...complete, reviewedById: "approver" });
    expect(result.ready).toBe(false);
    expect(result.failures).toContain("approvalSeparation");
  });

  it("allows explicitly configured break-glass evidence", () => {
    const result = evaluateReleaseGate({ ...complete, reviewedById: null, priorCreatedById: null, breakGlassAllowed: true });
    expect(result.ready).toBe(true);
  });
});

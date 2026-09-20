import { describe, expect, it } from "vitest";
import { evaluateReleaseGate } from "@/lib/releases/release-gate";

const complete = {
  signatureVerified: true, dependenciesVerified: true, sbomPresent: true,
  provenanceVerified: true, malwareClean: true, backupEvidencePresent: true,
  complianceEvidencePresent: true, migrationEvidencePresent: true,
  pendingComplianceCount: 0, reviewedById: "reviewer", priorCreatedById: "author",
  approvingAdminId: "approver", supplyChainSafe: true,
};

describe("V1 repository release gate", () => {
  it("passes when runtime integrity, malware, human review and safety checks pass", () => {
    const result = evaluateReleaseGate(complete);
    expect(result.ready).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("keeps V2 certification evidence advisory instead of blocking V1 publication", () => {
    const result = evaluateReleaseGate({
      ...complete,
      dependenciesVerified: false,
      sbomPresent: false,
      provenanceVerified: false,
      backupEvidencePresent: false,
      complianceEvidencePresent: false,
      migrationEvidencePresent: false,
      pendingComplianceCount: 99,
    });
    expect(result.ready).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("still blocks unsafe bytes, malware failures and missing human review", () => {
    expect(evaluateReleaseGate({ ...complete, malwareClean: false }).failures).toContain("malware");
    expect(evaluateReleaseGate({ ...complete, signatureVerified: false }).failures).toContain("signature");
    expect(evaluateReleaseGate({ ...complete, reviewedById: null }).failures).toContain("approval");
    expect(evaluateReleaseGate({ ...complete, supplyChainSafe: false }).failures).toContain("supplyChainSafe");
  });
});

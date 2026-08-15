import { describe, expect, it } from "vitest";
import { evaluateSupplyChainSecurity, type SupplyChainEvidenceEvent } from "@/lib/supply-chain/controls";
import { evaluateReleaseGate } from "@/lib/releases/release-gate";

const hash = "h".repeat(64);
const artifacts = [{ id: "a1", sha256: "a".repeat(64) }, { id: "a2", sha256: "b".repeat(64) }];
const at = new Date("2026-08-15T00:00:00.000Z");
const cleanEvidence: SupplyChainEvidenceEvent[] = [
  { kind: "SIGNATURE", result: "VERIFIED", artifactHash: hash, verifiedAt: at, signerKeyId: "supply-active" },
  { kind: "CHECKSUM", result: "VERIFIED", artifactHash: hash, verifiedAt: at, reference: hash },
  { kind: "MALWARE_SCAN", result: "CLEAN", artifactHash: hash, verifiedAt: at, metadata: { artifactId: "a1" } },
  { kind: "MALWARE_SCAN", result: "CLEAN", artifactHash: hash, verifiedAt: at, metadata: { artifactId: "a2" } },
];

describe("Phase 6.8 supply-chain security controls", () => {
  it("allows publication only with integrity, checksum, current scan history, and audit timestamps", () => {
    const state = evaluateSupplyChainSecurity({ currentHash: hash, artifacts, evidence: cleanEvidence, certificateStatus: "PENDING_PROVISIONING", malwareStatus: "CLEAN" });
    expect(state).toMatchObject({ releasable: true, integrityVerified: true, scanCurrent: true, auditTrailPresent: true });
  });

  it("fails closed when checksum/signing metadata is missing or scan evidence is stale", () => {
    expect(evaluateSupplyChainSecurity({ currentHash: hash, artifacts, evidence: cleanEvidence.filter((item) => item.kind !== "CHECKSUM") }).failures).toContain("integrity");
    expect(evaluateSupplyChainSecurity({ currentHash: "new-hash", artifacts, evidence: cleanEvidence }).failures).toEqual(expect.arrayContaining(["integrity", "currentScan"]));
  });

  it("quarantines infected artifacts and blocks compromised releases", () => {
    const infected = [...cleanEvidence, { kind: "MALWARE_SCAN", result: "INFECTED", artifactHash: hash, verifiedAt: at, metadata: { artifactId: "a1", quarantined: true } }];
    const compromised = [...cleanEvidence, { kind: "COMPROMISE", result: "COMPROMISED", artifactHash: hash, verifiedAt: at, failureReason: "stolen token" }];
    expect(evaluateSupplyChainSecurity({ currentHash: hash, artifacts, evidence: infected, malwareStatus: "INFECTED" })).toMatchObject({ releasable: false, quarantined: true });
    expect(evaluateSupplyChainSecurity({ currentHash: hash, artifacts, evidence: compromised }).failures).toContain("compromise");
  });

  it("honors emergency revocation until explicit resolution and feeds the release gate", () => {
    const revoked = [...cleanEvidence, { kind: "EMERGENCY_REVOCATION", result: "ACTIVE", artifactHash: hash, verifiedAt: at, failureReason: "compromised signing key" }];
    const state = evaluateSupplyChainSecurity({ currentHash: hash, artifacts, evidence: revoked, certificateStatus: "REVOKED" });
    expect(state.failures).toEqual(expect.arrayContaining(["revocation", "certificateRevoked"]));
    const gate = evaluateReleaseGate({ signatureVerified: true, dependenciesVerified: true, sbomPresent: true, provenanceVerified: true, malwareClean: true, backupEvidencePresent: true, complianceEvidencePresent: true, migrationEvidencePresent: true, pendingComplianceCount: 0, reviewedById: "reviewer", priorCreatedById: "author", approvingAdminId: "approver", supplyChainSafe: state.releasable });
    expect(gate.ready).toBe(false);
    expect(gate.failures).toContain("supplyChainSafe");
  });
});

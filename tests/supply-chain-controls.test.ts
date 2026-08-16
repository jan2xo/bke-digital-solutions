import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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

  it("fails closed when a later malware scan fails after historical clean evidence", () => {
    const failedAfterClean = [
      ...cleanEvidence,
      { kind: "MALWARE_SCAN", result: "FAILED", artifactHash: hash, verifiedAt: new Date("2026-08-15T01:00:00.000Z"), metadata: { artifactId: "a1" }, failureReason: "scanner timeout" },
    ];
    const state = evaluateSupplyChainSecurity({ currentHash: hash, artifacts, evidence: failedAfterClean, malwareStatus: "FAILED" });
    expect(state).toMatchObject({ releasable: false, scanCurrent: false });
    expect(state.failures).toEqual(expect.arrayContaining(["currentScan", "malwareScanFailed"]));
  });

  it("does not let installer upload publish=true bypass recent auth or the release evidence gate", () => {
    const route = readFileSync("app/api/admin/products/[id]/versions/route.ts", "utf8");
    expect(route).toContain("input.publish === \"true\" ? await requireRecentAdmin() : await requireAdmin()");
    expect(route.indexOf("if (input.publish === \"true\") throw new Error(\"RELEASE_EVIDENCE_INCOMPLETE\")")).toBeLessThan(route.indexOf("await uploadObject"));
  });

  it("honors emergency revocation until explicit resolution and feeds the release gate", () => {
    const revoked = [...cleanEvidence, { kind: "EMERGENCY_REVOCATION", result: "ACTIVE", artifactHash: hash, verifiedAt: at, failureReason: "compromised signing key" }];
    const state = evaluateSupplyChainSecurity({ currentHash: hash, artifacts, evidence: revoked, certificateStatus: "REVOKED" });
    expect(state.failures).toEqual(expect.arrayContaining(["revocation", "certificateRevoked"]));
    const gate = evaluateReleaseGate({ signatureVerified: true, dependenciesVerified: true, sbomPresent: true, provenanceVerified: true, malwareClean: true, backupEvidencePresent: true, complianceEvidencePresent: true, migrationEvidencePresent: true, pendingComplianceCount: 0, reviewedById: "reviewer", priorCreatedById: "author", approvingAdminId: "approver", supplyChainSafe: state.releasable });
    expect(gate.ready).toBe(false);
    expect(gate.failures).toContain("supplyChainSafe");
  });

  it("keeps SBOM and provenance recording scoped to the current canonical payload", () => {
    const route = readFileSync("app/api/admin/supply-chain/route.ts", "utf8");
    expect(route).toContain('"RECORD_SBOM", "RECORD_PROVENANCE"');
    expect(route).toContain("input.evidenceHash !== canonicalPayloadHash");
    expect(route).toContain('kind === "SBOM" ? { sbomReference: input.reference } : kind === "PROVENANCE"');
    expect(readFileSync("app/api/admin/versions/[id]/route.ts", "utf8")).toContain("provenanceVerified: evidence?.provenanceStatus === \"VERIFIED\"");
  });

  it("records the remaining release gates only as current verified evidence", () => {
    const route = readFileSync("app/api/admin/supply-chain/route.ts", "utf8");
    expect(route).toContain('"RECORD_DEPENDENCIES", "RECORD_BACKUP", "RECORD_COMPLIANCE", "RECORD_MIGRATION"');
    expect(route).toContain("input.evidenceHash !== canonicalPayloadHash");
    const lifecycle = readFileSync("app/api/admin/versions/[id]/route.ts", "utf8");
    expect(lifecycle).toContain('currentEvidence("DEPENDENCIES")');
    expect(lifecycle).toContain('currentEvidence("BACKUP")');
    expect(lifecycle).toContain('currentEvidence("COMPLIANCE")');
    expect(lifecycle).toContain('currentEvidence("MIGRATION")');
  });

  it("requires server-verified durable evidence documents and makes replay storage idempotent", () => {
    const route = readFileSync("app/api/admin/supply-chain/route.ts", "utf8");
    expect(route).toContain("documentBase64");
    expect(route).toContain('createHash("sha256").update(document)');
    expect(route).toContain("documentObjectKey");
    expect(route).toContain("assertObjectExists(objectKey)");
    expect(route).toContain("existing.verificationEvidence.find");
    expect(route).toContain("EVIDENCE_REFERENCE_NOT_DURABLE");
    const backup = readFileSync("lib/backups/engine.ts", "utf8");
    expect(backup).toContain("evidenceDocuments");
    expect(backup).toContain("verifyRestoredEvidenceObjects");
  });
});

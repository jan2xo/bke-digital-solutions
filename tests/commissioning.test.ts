import { describe, expect, it } from "vitest";
import { COMMISSIONING_EVIDENCE_KINDS, classifyArtifact, commissioningEvidenceDecision } from "@/lib/commissioning/types";

describe("BKE commissioning classification", () => {
  it("supports legacy binaries, archives, and scripts without GitHub", () => {
    expect(classifyArtifact("old-installer.exe", "application/octet-stream")).toBe("WINDOWS_BINARY");
    expect(classifyArtifact("vMix-script.js", "text/javascript")).toBe("SCRIPT");
    expect(classifyArtifact("plugin.zip", "application/zip")).toBe("ZIP_ARCHIVE");
  });
  it("uses a generic fallback instead of fabricating certainty", () => {
    expect(classifyArtifact("unknown.dat", "application/octet-stream")).toBe("GENERIC_BINARY");
  });
});

describe("BKE commissioning evidence policy", () => {
  const limitations = ["Metadata-only analysis"];

  it("accepts completed assessments without rewriting uncertainty as VERIFIED", () => {
    const sbom = commissioningEvidenceDecision("SBOM", "UNDETERMINED", { schema: "bke.commissioning.evidence.v1", limitations });
    const dependencies = commissioningEvidenceDecision("DEPENDENCIES", "NONE_OBSERVED", { schema: "bke.dependency-analysis.v1", limitations });
    const migration = commissioningEvidenceDecision("MIGRATION", "UNDETERMINED", { schema: "bke.migration-assessment.v1", category: "UNKNOWN", limitations });

    expect(sbom).toMatchObject({ recognized: true, accepted: true });
    expect(dependencies).toMatchObject({ recognized: true, accepted: true });
    expect(migration).toMatchObject({ recognized: true, accepted: true });
    expect(sbom.detail).toContain("UNDETERMINED");
    expect(dependencies.detail).toContain("NONE_OBSERVED");
    expect(migration.detail).toContain("UNKNOWN");
  });

  it("rejects failed analysis and requires verified BKE custody provenance", () => {
    expect(commissioningEvidenceDecision("SBOM", "FAILED", { schema: "bke.commissioning.evidence.v1", limitations }).accepted).toBe(false);
    expect(commissioningEvidenceDecision("PROVENANCE", "UNDETERMINED", { schema: "bke.provenance.custody.v1", limitations }).accepted).toBe(false);
    expect(commissioningEvidenceDecision("PROVENANCE", "VERIFIED", { schema: "bke.provenance.custody.v1", limitations })).toMatchObject({ recognized: true, accepted: true });
  });

  it("limits replacement to the four commissioning-owned evidence classes", () => {
    expect(COMMISSIONING_EVIDENCE_KINDS).toEqual(["SBOM", "DEPENDENCIES", "PROVENANCE", "MIGRATION"]);
    expect(COMMISSIONING_EVIDENCE_KINDS).not.toContain("MALWARE_SCAN");
    expect(COMMISSIONING_EVIDENCE_KINDS).not.toContain("SIGNATURE");
    expect(COMMISSIONING_EVIDENCE_KINDS).not.toContain("COMPLIANCE");
  });
});

export const COMMISSIONING_POLICY_VERSION = "bke-commissioning-mvp.v1";
export const COMMISSIONING_GENERATOR_VERSION = "bke-evidence-generators.v1";

export type ArtifactClassification = "WINDOWS_BINARY" | "MACOS_PACKAGE" | "LINUX_PACKAGE" | "ZIP_ARCHIVE" | "SCRIPT" | "GENERIC_BINARY" | "GENERIC_ARCHIVE";
export type EvidenceResult = "COMPLETE" | "PARTIAL" | "NOT_APPLICABLE" | "UNDETERMINED" | "FAILED";
export type CommissioningEvidenceKind = "SBOM" | "DEPENDENCIES" | "PROVENANCE" | "MIGRATION";
export const COMMISSIONING_EVIDENCE_KINDS: CommissioningEvidenceKind[] = ["SBOM", "DEPENDENCIES", "PROVENANCE", "MIGRATION"];

export type ArtifactDescriptor = { id: string; name: string; objectKey: string; sha256: string; sizeBytes: bigint; contentType: string; productId: string; versionId: string; version: string };
export type CommissioningEvidence = { schema: string; bomFormat?: "CycloneDX"; specVersion?: string; version?: number; result: EvidenceResult; artifactSha256: string; artifactId: string; generatedAt: string; generator: string; method: string; components?: unknown[]; dependencies?: unknown[]; classification?: ArtifactClassification; limitations: string[] };
export type AnalyzerMatch = { matched: boolean; confidence: "HIGH" | "MEDIUM" | "LOW" };
export type AnalysisContext = { artifact: Readonly<ArtifactDescriptor>; bytes: AsyncIterable<Uint8Array>; commissioningRunId: string };
export type ArtifactAnalysis = { classification: ArtifactClassification; sbom: CommissioningEvidence; dependencies: CommissioningEvidence; limitations: string[] };
export interface ArtifactAnalyzer { readonly id: string; readonly version: string; canAnalyze(artifact: Readonly<ArtifactDescriptor>): Promise<AnalyzerMatch>; analyze(context: AnalysisContext): Promise<ArtifactAnalysis>; }

export type CommissioningGateDecision = { recognized: boolean; accepted: boolean; detail: string };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function hasLimitations(metadata: Record<string, unknown>): boolean {
  return Array.isArray(metadata.limitations);
}

export function commissioningEvidenceDecision(kind: string, result: string, metadata: unknown): CommissioningGateDecision {
  const value = record(metadata);
  if (!value) return { recognized: false, accepted: false, detail: "Not BKE commissioning evidence" };

  if (kind === "PROVENANCE" && value.schema === "bke.provenance.custody.v1") {
    return result === "VERIFIED"
      ? { recognized: true, accepted: true, detail: "BKE custody provenance verified" }
      : { recognized: true, accepted: false, detail: `BKE custody provenance ${result}` };
  }

  if (kind === "SBOM" && value.schema === "bke.commissioning.evidence.v1") {
    const accepted = hasLimitations(value) && ["COMPLETE", "PARTIAL", "NOT_APPLICABLE", "UNDETERMINED"].includes(result);
    return { recognized: true, accepted, detail: accepted ? `BKE SBOM assessment complete: ${result}` : `BKE SBOM assessment ${result}` };
  }

  if (kind === "DEPENDENCIES" && value.schema === "bke.dependency-analysis.v1") {
    const accepted = hasLimitations(value) && ["VERIFIED_COMPLETE", "VERIFIED_PARTIAL", "NONE_OBSERVED", "NOT_APPLICABLE", "UNDETERMINED"].includes(result);
    return { recognized: true, accepted, detail: accepted ? `BKE dependency assessment complete: ${result}` : `BKE dependency assessment ${result}` };
  }

  if (kind === "MIGRATION" && value.schema === "bke.migration-assessment.v1") {
    const accepted = hasLimitations(value) && ["VERIFIED", "NOT_APPLICABLE", "UNDETERMINED"].includes(result);
    return { recognized: true, accepted, detail: accepted ? `BKE migration assessment complete: ${String(value.category ?? result)} / ${result}` : `BKE migration assessment ${result}` };
  }

  return { recognized: false, accepted: false, detail: "Not BKE commissioning evidence" };
}

export function classifyArtifact(name: string, contentType: string): ArtifactClassification {
  const lower = name.toLowerCase();
  if (/\.(zip|jar|vsix|crx)$/.test(lower) || contentType.includes("zip")) return "ZIP_ARCHIVE";
  if (/\.(ps1|js|jsx|ts|tsx|py|sh|cmd|bat|vbs|jsxbin)$/.test(lower)) return "SCRIPT";
  if (/\.(dmg|pkg|app)$/.test(lower) || contentType.includes("x-apple")) return "MACOS_PACKAGE";
  if (/\.(deb|rpm|appimage)$/.test(lower) || contentType.includes("linux")) return "LINUX_PACKAGE";
  if (/\.(exe|msi|dll)$/.test(lower) || contentType.includes("windows")) return "WINDOWS_BINARY";
  if (/archive|compressed/.test(contentType)) return "GENERIC_ARCHIVE";
  return "GENERIC_BINARY";
}

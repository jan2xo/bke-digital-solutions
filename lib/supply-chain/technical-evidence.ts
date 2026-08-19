type EvidenceDocument = Record<string, unknown>;

function parse(document: Buffer, kind: string): EvidenceDocument {
  try {
    const value: unknown = JSON.parse(document.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value as EvidenceDocument;
  } catch {
    throw new Error(`${kind}_EVIDENCE_INVALID`);
  }
}

/** Validate the repository-owned evidence formats before they can become VERIFIED. */
export function validateTechnicalEvidence(kind: string, document: Buffer, releaseVersion: string) {
  const value = parse(document, kind);
  if (kind === "SBOM") {
    const metadata = value.metadata;
    const component = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>).component : null;
    if (value.bomFormat !== "CycloneDX" || typeof value.specVersion !== "string" || !Array.isArray(value.components) || !component || typeof component !== "object" || (component as Record<string, unknown>).version !== releaseVersion) throw new Error("SBOM_EVIDENCE_INVALID");
  } else if (kind === "PROVENANCE") {
    if (value.format !== "bke.provenance.v1" || value.releaseIdentifier !== releaseVersion || typeof value.commitHash !== "string" || !value.commitHash || typeof value.buildEnvironment !== "string" || !value.buildEnvironment || typeof value.builderIdentity !== "string" || !value.builderIdentity || typeof value.builtAt !== "string" || Number.isNaN(Date.parse(value.builtAt))) throw new Error("PROVENANCE_EVIDENCE_INVALID");
  } else if (kind === "DEPENDENCIES") {
    const status = (name: string) => { const entry = value[name]; return entry && typeof entry === "object" && !Array.isArray(entry) && (entry as Record<string, unknown>).status === "PASS"; };
    if (value.format !== "bke.dependency-evidence.v1" || value.releaseVersion !== releaseVersion || !status("lockConsistency") || !status("resolution") || !status("audit")) throw new Error("DEPENDENCIES_EVIDENCE_INVALID");
  }
  return value;
}

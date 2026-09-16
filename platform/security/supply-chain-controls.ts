export type SupplyChainEvidenceEvent = {
  kind: string;
  result: string;
  artifactHash: string;
  verifiedAt?: Date | string;
  signerKeyId?: string | null;
  scannerId?: string | null;
  scannerVersion?: string | null;
  reference?: string | null;
  failureReason?: string | null;
  metadata?: unknown;
};

export type SupplyChainSecurityState = {
  currentHash: string;
  evidence: SupplyChainEvidenceEvent[];
  artifacts: Array<{ id: string; sha256?: string }>;
  certificateStatus?: string | null;
  malwareStatus?: string | null;
};

export type SupplyChainSecurityEvaluation = {
  releasable: boolean;
  quarantined: boolean;
  revoked: boolean;
  compromised: boolean;
  integrityVerified: boolean;
  scanCurrent: boolean;
  auditTrailPresent: boolean;
  failures: string[];
};

function artifactIdFor(item: SupplyChainEvidenceEvent): string {
  return typeof item.metadata === "object" && item.metadata && "artifactId" in item.metadata ? String((item.metadata as { artifactId: unknown }).artifactId) : "";
}

function metadataFlag(metadata: unknown, key: string): boolean {
  return Boolean(typeof metadata === "object" && metadata && key in metadata && (metadata as Record<string, unknown>)[key]);
}

function latestResult(evidence: SupplyChainEvidenceEvent[], kinds: string[]): SupplyChainEvidenceEvent | undefined {
  return evidence
    .filter((item) => kinds.includes(item.kind))
    .sort((a, b) => new Date(b.verifiedAt ?? 0).getTime() - new Date(a.verifiedAt ?? 0).getTime())[0];
}

export function evaluateSupplyChainSecurity(state: SupplyChainSecurityState): SupplyChainSecurityEvaluation {
  const current = state.evidence.filter((item) => item.artifactHash === state.currentHash);
  const failedMalwareStatus = state.malwareStatus === "FAILED";
  const quarantined = state.malwareStatus === "INFECTED" || current.some((item) => item.result === "INFECTED" || item.kind === "QUARANTINE" || metadataFlag(item.metadata, "quarantined"));
  const revocation = latestResult(state.evidence, ["REVOCATION", "EMERGENCY_REVOCATION"]);
  const revoked = Boolean(revocation && revocation.result !== "RESOLVED");
  const compromised = current.some((item) => item.kind === "COMPROMISE" || item.result === "COMPROMISED" || metadataFlag(item.metadata, "compromised"));
  const integrityVerified = Boolean(
    current.some((item) => item.kind === "SIGNATURE" && item.result === "VERIFIED") &&
    current.some((item) => item.kind === "CHECKSUM" && item.result === "VERIFIED")
  );
  const latestScanByArtifact = new Map<string, SupplyChainEvidenceEvent>();
  for (const item of current.filter((event) => event.kind === "MALWARE_SCAN")) {
    const artifactId = artifactIdFor(item);
    const existing = latestScanByArtifact.get(artifactId);
    if (!existing || new Date(item.verifiedAt ?? 0).getTime() >= new Date(existing.verifiedAt ?? 0).getTime()) latestScanByArtifact.set(artifactId, item);
  }
  const scanCurrent = !failedMalwareStatus && state.artifacts.length > 0 && state.artifacts.every((artifact) => latestScanByArtifact.get(artifact.id)?.result === "CLEAN");
  const auditTrailPresent = state.evidence.some((item) => ["SIGNATURE", "CHECKSUM", "MALWARE_SCAN"].includes(item.kind) && item.artifactHash === state.currentHash) && state.evidence.every((item) => Boolean(item.verifiedAt));
  const failures = [
    !integrityVerified && "integrity",
    !scanCurrent && "currentScan",
    quarantined && "quarantine",
    revoked && "revocation",
    compromised && "compromise",
    !auditTrailPresent && "auditTrail",
    failedMalwareStatus && "malwareScanFailed",
    state.certificateStatus === "REVOKED" && "certificateRevoked",
  ].filter(Boolean) as string[];
  return { releasable: failures.length === 0, quarantined, revoked, compromised, integrityVerified, scanCurrent, auditTrailPresent, failures };
}

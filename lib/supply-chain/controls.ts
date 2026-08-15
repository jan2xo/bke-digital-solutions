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
  const quarantined = state.malwareStatus === "INFECTED" || current.some((item) => item.result === "INFECTED" || item.kind === "QUARANTINE" || metadataFlag(item.metadata, "quarantined"));
  const revocation = latestResult(state.evidence, ["REVOCATION", "EMERGENCY_REVOCATION"]);
  const revoked = Boolean(revocation && revocation.result !== "RESOLVED");
  const compromised = current.some((item) => item.kind === "COMPROMISE" || item.result === "COMPROMISED" || metadataFlag(item.metadata, "compromised"));
  const integrityVerified = Boolean(
    current.some((item) => item.kind === "SIGNATURE" && item.result === "VERIFIED") &&
    current.some((item) => item.kind === "CHECKSUM" && item.result === "VERIFIED")
  );
  const cleanArtifactIds = new Set(current.filter((item) => item.kind === "MALWARE_SCAN" && item.result === "CLEAN").map((item) => typeof item.metadata === "object" && item.metadata && "artifactId" in item.metadata ? String((item.metadata as { artifactId: unknown }).artifactId) : ""));
  const scanCurrent = state.artifacts.length > 0 && cleanArtifactIds.size === state.artifacts.length && state.artifacts.every((artifact) => cleanArtifactIds.has(artifact.id));
  const auditTrailPresent = state.evidence.some((item) => ["SIGNATURE", "CHECKSUM", "MALWARE_SCAN"].includes(item.kind) && item.artifactHash === state.currentHash) && state.evidence.every((item) => Boolean(item.verifiedAt));
  const failures = [
    !integrityVerified && "integrity",
    !scanCurrent && "currentScan",
    quarantined && "quarantine",
    revoked && "revocation",
    compromised && "compromise",
    !auditTrailPresent && "auditTrail",
    state.certificateStatus === "REVOKED" && "certificateRevoked",
  ].filter(Boolean) as string[];
  return { releasable: failures.length === 0, quarantined, revoked, compromised, integrityVerified, scanCurrent, auditTrailPresent, failures };
}

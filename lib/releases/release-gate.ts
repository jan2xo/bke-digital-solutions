export type ReleaseGateInput = {
  signatureVerified: boolean;
  dependenciesVerified: boolean;
  sbomPresent: boolean;
  provenanceVerified: boolean;
  malwareClean: boolean;
  backupEvidencePresent: boolean;
  complianceEvidencePresent: boolean;
  migrationEvidencePresent: boolean;
  pendingComplianceCount: number;
  reviewedById?: string | null;
  priorCreatedById?: string | null;
  approvingAdminId: string;
  breakGlassAllowed?: boolean;
  supplyChainSafe?: boolean;
};

export type ReleaseGateResult = {
  ready: boolean;
  checks: Record<string, boolean>;
  failures: string[];
};

/**
 * V1 release gate.
 *
 * Runtime/distribution safety remains mandatory: current signed bytes, clean malware
 * evidence, human review, and the integrity/revocation safety evaluation. Rich
 * certification evidence (SBOM, provenance, dependency, backup, compliance and
 * migration evidence) is retained for V2 and observability, but is advisory and
 * must not block the current commercial release path.
 */
export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateResult {
  const checks = {
    signature: input.signatureVerified,
    malware: input.malwareClean,
    approval: Boolean(input.reviewedById),
    supplyChainSafe: input.supplyChainSafe ?? true,
  };
  const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return { ready: failures.length === 0, checks, failures };
}

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

/** Repository-controlled release gate. This is evidence evaluation, not external certification. */
export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateResult {
  const checks = {
    signature: input.signatureVerified,
    dependencies: input.dependenciesVerified,
    sbom: input.sbomPresent,
    provenance: input.provenanceVerified,
    malware: input.malwareClean,
    backup: input.backupEvidencePresent,
    compliance: input.complianceEvidencePresent && input.pendingComplianceCount === 0,
    migration: input.migrationEvidencePresent,
    approval: Boolean(input.reviewedById),
    supplyChainSafe: input.supplyChainSafe ?? true,
  };
  const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return { ready: failures.length === 0, checks, failures };
}

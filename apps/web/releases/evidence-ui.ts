export type ReleaseEvidenceStatus = "Evidence verified" | "Waiting for automated evidence";

export function releaseEvidenceSummary(blocked: readonly string[], approvalStatus: string): { evidence: ReleaseEvidenceStatus; approval: string } {
  const machineBlocked = blocked.filter((kind) => kind !== "COMPLIANCE");
  return { evidence: machineBlocked.length ? "Waiting for automated evidence" : "Evidence verified", approval: approvalStatus };
}

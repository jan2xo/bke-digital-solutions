export type ReleaseEvidenceStatus = "Evidence verified" | "Waiting for automated evidence";

export function releaseEvidenceSummary(machineBlocked: readonly string[], approvalStatus: string): { evidence: ReleaseEvidenceStatus; approval: string } {
  return { evidence: machineBlocked.length ? "Waiting for automated evidence" : "Evidence verified", approval: approvalStatus };
}

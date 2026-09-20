export type ApprovalRecord = {
  payloadHash?: string | null;
  reviewedById?: string | null;
  approvedById?: string | null;
  reviewedAt?: Date | null;
  approvedAt: Date | null;
  createdById?: string;
};

export function currentApproval(approvals: ApprovalRecord[], payloadHash: string) {
  const current = approvals.find((approval) => approval.payloadHash === payloadHash && approval.reviewedById && approval.approvedById && approval.reviewedAt && approval.approvedAt);
  if (!current) return { valid: false, approval: undefined };
  return { valid: true, approval: current };
}

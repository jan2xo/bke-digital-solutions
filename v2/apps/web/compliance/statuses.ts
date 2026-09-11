export const COMPLIANCE_STATUSES = [
  "PENDING_OWNER_DECISION",
  "PENDING_LAWYER_REVIEW",
  "PENDING_ACCOUNTANT_REVIEW",
  "PENDING_DPO_REVIEW",
  "PENDING_REGULATORY_APPROVAL",
] as const;

export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export const COMPLIANCE_STATUS_LABELS: Record<ComplianceStatus, string> = {
  PENDING_OWNER_DECISION: "Pending owner decision",
  PENDING_LAWYER_REVIEW: "Pending lawyer review",
  PENDING_ACCOUNTANT_REVIEW: "Pending accountant/BIR review",
  PENDING_DPO_REVIEW: "Pending DPO/privacy review",
  PENDING_REGULATORY_APPROVAL: "Pending regulatory approval",
};

export function isMutableComplianceStatus(value: string): value is ComplianceStatus {
  return (COMPLIANCE_STATUSES as readonly string[]).includes(value);
}

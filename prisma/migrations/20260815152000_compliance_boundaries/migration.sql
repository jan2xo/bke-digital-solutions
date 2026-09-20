ALTER TABLE "ComplianceRequirement"
  ADD CONSTRAINT "ComplianceRequirement_status_allowed_chk"
  CHECK ("status" IN ('IMPLEMENTED', 'PENDING_OWNER_DECISION', 'PENDING_LAWYER_REVIEW', 'PENDING_ACCOUNTANT_REVIEW', 'PENDING_DPO_REVIEW', 'PENDING_REGULATORY_APPROVAL'));

CREATE OR REPLACE FUNCTION prevent_compliance_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'COMPLIANCE_EVIDENCE_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ComplianceEvidence_prevent_update"
BEFORE UPDATE ON "ComplianceEvidence"
FOR EACH ROW EXECUTE FUNCTION prevent_compliance_evidence_mutation();

CREATE TRIGGER "ComplianceEvidence_prevent_delete"
BEFORE DELETE ON "ComplianceEvidence"
FOR EACH ROW EXECUTE FUNCTION prevent_compliance_evidence_mutation();

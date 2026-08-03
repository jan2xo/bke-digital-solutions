# Privacy deletion workflow

1. A recent MFA-verified administrator starts privacy review and supplies an approved future retention-expiry date.
2. Sessions are revoked and the subject/account enters `PRIVACY_REVIEW`.
3. Apply legal hold if any dispute, tax, fraud, payment, refund, investigation, or legal obligation exists.
4. Review the dry-run blocker report and preserved-history counts.
5. When no legal hold exists, type the confirmation and pseudonymize personal data.
6. After retention expiry, mark purge eligible only if the report allows it.
7. Execute final purge only with the subject-specific typed phrase and zero blockers.

Pseudonymization is normally the terminal privacy action when commercial or legal evidence must remain. Final purge is intentionally unavailable when immutable acceptances or preserved history exist. This workflow is technical enforcement, not a claim of GDPR, Philippine Data Privacy Act, tax, BIR, or accounting compliance.

# Legal hold

A legal hold freezes purge eligibility for a customer and all owned accounts. Administrators may apply or remove it only with MFA and recent authentication; both actions are audited and emit a security lifecycle event. The stored reason is bounded and should use a case classification, not sensitive narrative.

Apply a hold for disputes, investigations, fraud review, tax/accounting duties, pending refunds/chargebacks, reconciliation mismatches, or counsel direction. A hold does not grant access or reactivate entitlements. Removal does not automatically purge; retention expiry, pseudonymization, and every other blocker are re-evaluated.

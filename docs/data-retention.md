# Data retention

Phase 6.1 separates access termination from privacy minimization and irreversible purge. It does not define a legally sufficient retention period.

## Preserved records

Closure and pseudonymization preserve orders/items, attempts/payments/refunds, invoices/lines, subscriptions, licenses/events, activations needed for operational evidence, trial/redemption history, webhook evidence, audit/security events, immutable legal acceptances, and minimized email-delivery evidence. Immutable order/invoice snapshots are not rewritten because they support accounting and disputes.

## Minimized personal data

Pseudonymization removes the user name, verification state, credentials, sessions, reset/verification tokens, tax ID, customer display identity, and deliverable email. It retains an HMAC email hash for abuse/trial/duplicate controls and replaces email with a non-deliverable `privacy.invalid` alias. Matching outbox recipients and payloads are minimized. No plaintext original email is written to audit metadata.

## Retention blockers

Legal hold, active/past-due/pending subscription, pending or refundable payment, owned organization, unrelated membership, license assignment, commercial history, immutable legal acceptance, administrator role, or unexpired retention date blocks purge as applicable. Phase 6.7 must approve the final policy, periods, and treatment of immutable acceptance network metadata.

Migrations are forward-only. Correct policy defects with a reviewed forward migration; never weaken legal triggers or delete evidence manually.

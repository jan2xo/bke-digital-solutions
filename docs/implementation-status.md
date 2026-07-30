# Implementation status

## Completed modules

- Authentication, verified-email flows, password reset, session revocation, global RBAC
- Customer/account ownership, catalog, checkout, mock/PayMongo abstraction, webhook idempotency
- Invoices, subscriptions, licenses, device activation, private one-time downloads
- Admin dashboard, products, releases, artifacts, customers, licenses, devices, orders, invoices, and audit centers
- Transactional email abstraction and commerce outbox
- Guarded, audited permanent deletion of archived products with dependency preview, typed confirmation, and storage rollback policy
- Product editions and server-authoritative perpetual, monthly, and derived annual plans across administration, storefront, checkout, invoices, licensing, activation, and customer history
- Pending-order hosted-checkout continuation, recorded replacement sessions, pending-only cancellation, and late-payment webhook recovery
- Account-selectable product trials with UTC annual eligibility, administrator grants, 0–14 day grace management, revocation, and standard entitlement enforcement
- Administrator-only permanent customer deletion, including commerce and licensing history, protected by recent authentication, origin validation, exact email and destructive-phrase confirmation, rate limiting, a serializable transaction, and a redacted audit tombstone

## In progress

- Credential-gated PayMongo sandbox certification
- Credential-gated Resend delivery certification
- Production infrastructure selection and provisioning

## Deferred

- Automated refund initiation, accounting-grade revenue, BIR integration
- Public rendering pipeline for uploaded product imagery
- Bulk administration actions and advanced analytics
- Admin MFA and broader recent-authentication enforcement

## Known issues and technical debt

- Customer and administrator license-key reveal is repeatable, authenticated, ownership/RBAC protected, and audited. Recent-authentication and administrator MFA remain required production hardening because encrypted key material is retained server-side.
- Artifact replacement deletes the old object best-effort after the database switch; orphan cleanup should be scheduled.
- Audit CSV is capped at 5,000 rows and should move to queued exports at scale.
- Search uses database substring matching; dedicated search is deferred.
- Permanent customer deletion intentionally removes orders, payments, invoices, licenses, and personal data. Production use remains blocked until legal, tax, accounting, privacy, and backup-retention requirements approve that policy.

## Future improvements

Admin MFA, approval workflows, queued exports, malware scanning/code signing, object-retention jobs, accounting integration, and richer organization administration.

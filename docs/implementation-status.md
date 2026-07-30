# Implementation status

## Completed modules

- Authentication, verified-email flows, password reset, session revocation, global RBAC
- Customer/account ownership, catalog, checkout, mock/PayMongo abstraction, webhook idempotency
- Invoices, subscriptions, licenses, device activation, private one-time downloads
- Admin dashboard, products, releases, artifacts, customers, licenses, devices, orders, invoices, and audit centers
- Transactional email abstraction and commerce outbox
- Guarded, audited permanent deletion of archived products with dependency preview, typed confirmation, and storage rollback policy

## In progress

- Credential-gated PayMongo sandbox certification
- Credential-gated Resend delivery certification
- Production infrastructure selection and provisioning

## Deferred

- Automated refund initiation, accounting-grade revenue, BIR integration
- Public rendering pipeline for uploaded product imagery
- Bulk administration actions and advanced analytics
- Admin MFA and recent-authentication enforcement

## Known issues and technical debt

- Admin one-time license reveal is intentionally irreversible and should gain recent-auth/MFA before production.
- Artifact replacement deletes the old object best-effort after the database switch; orphan cleanup should be scheduled.
- Audit CSV is capped at 5,000 rows and should move to queued exports at scale.
- Search uses database substring matching; dedicated search is deferred.

## Future improvements

Admin MFA, approval workflows, queued exports, malware scanning/code signing, object-retention jobs, accounting integration, and richer organization administration.

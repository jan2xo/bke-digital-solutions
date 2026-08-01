# Implementation status

Phase 5.2 local Docker+Caddy certification scaffolding is implemented. Real PayMongo sandbox and Resend delivery remain credential/owner-action gated and cannot be marked passed until evidence is recorded.

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
- Complete browser and route-level certification of the implemented administrator MFA and recent-authentication controls

## Known issues and technical debt

- Customer and administrator license-key reveal is repeatable, ownership/RBAC protected, audited, and now requires recent authentication; administrator access also requires MFA. Browser certification remains required because encrypted key material is retained server-side.
- Artifact replacement deletes the old object best-effort after the database switch; orphan cleanup should be scheduled.
- Audit CSV is capped at 5,000 rows and should move to queued exports at scale.
- Search uses database substring matching; dedicated search is deferred.
- Permanent customer deletion intentionally removes orders, payments, invoices, licenses, and personal data. Production use remains blocked until legal, tax, accounting, privacy, and backup-retention requirements approve that policy.

## Future improvements

Admin MFA, approval workflows, queued exports, malware scanning/code signing, object-retention jobs, accounting integration, and richer organization administration.
# Flexible discount and customer-offer status

Implemented locally: general promotions, account-specific offers, administrative adjustments, exact integer pricing, annual-catalog separation, immutable order/subscription snapshots, finite monthly promotional cycles, serialized redemption limits, explicitly authorized zero totals, admin controls, checkout selection, audit records, and integration coverage. Migration `20260731025700_flexible_discount_offers` has been applied to the local development PostgreSQL database. See `discount-offers.md`.

Credential-gated PayMongo sandbox and Resend delivery certification remain external blockers. Abandoned offer reservations remain consumed until a future provider-aware finality/release job is designed and verified.
# Infrastructure status — August 2026

`jl-bke.com` is the canonical production domain, Cloudflare is authoritative DNS, Namecheap is the registrar, and Resend has verified the production sending domain. Docker/Caddy/PostgreSQL/Valkey/MinIO deployment configuration exists, but no VPS or public HTTPS deployment exists yet. Development remains local-first and environment-driven.

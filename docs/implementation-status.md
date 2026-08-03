# Implementation status

## Phase 6.0 runtime parity (committed and pushed)

- Production and certification use the same digest-pinned application, database-migration, and startup contract; certification adds only loopback test access and local simulation configuration.
- Prisma generation is reproducible, all 17 migrations are applied, repeated seeding and database smoke pass, and readiness fails closed for PostgreSQL, Valkey, private storage, and selected-provider configuration failures.
- TypeScript, ESLint, full Vitest, full Playwright, local production build, Docker production build, Compose validation, secret hygiene, and the runtime dependency audit pass. See `runtime-parity.md` for exact results and limits.
- Genuine PayMongo lifecycle and credential-gated provider delivery are intentionally not certified by Phase 6.0 and remain later gates.

## Administrator email-code authentication (implemented and browser verified)

- Replaced authenticator-app enrollment and TOTP challenges for global administrators with password-plus-email-code verification through the configured Resend provider.
- Added ten-minute, purpose-isolated, five-attempt, single-use challenges for enrollment, login, resend, and recent authentication. Codes are HMAC-derived from random HttpOnly challenge tokens and are never stored or logged.
- Preserved offline single-use recovery codes, MFA-verified server sessions, recent-authentication gates, rate limiting, audit/security events, and the customer password/magic-link flows.
- Added migrations `20260803090000_admin_email_otp` and `20260803140000_admin_email_otp_hash`, which remove stored authenticator seeds, add the email-code session method and challenge purposes, and persist only a keyed code hash.
- Prisma validation, migration deployment, generated-client synchronization, TypeScript, ESLint, focused unit tests, and the full certification browser suite pass. Explicit route-response cookies fixed the challenge timing defect found by the first browser run.

## Phase 6.1A — Legal Document Management System (committed and pushed)

- Added normalized legal documents, versions, and immutable acceptance records with two additive migrations.
- Added an MFA-protected administrator Legal & Compliance center for creation, title edits, drafts, preview, publishing, archive/restore, duplication, comparison, search/filter, acceptance counts/history, and draft-only deletion.
- Added current and historical public legal routes with safe Markdown rendering and environment-driven template variables.
- Registration now requires current Terms and Privacy versions; checkout requires EULA and Refund Policy, with Subscription Terms added for recurring plans and renewals.
- Versions flagged for reacceptance redirect the next customer login and protected portal navigation without revoking sessions.
- Seeded nine clearly labeled non-legal templates. Professional review and replacement remain a commercial-launch blocker.
- Verification results are recorded in the developer journal and must remain distinguished from credential-gated provider certification.
- Known integration boundary: immutable acceptances intentionally prevent the legacy permanent-customer deletion path from erasing a registered customer's evidence. Phase 6.1 must replace that destructive workflow with governed retention/pseudonymization; do not weaken the legal triggers.

## Phase 6.1 — Data Integrity and Safe Deletion (implemented, uncommitted, under review)

- Replaced customer hard deletion with suspension, closure/reopen, privacy review, legal hold, pseudonymization, purge eligibility, and deliberately constrained final purge.
- Closure revokes sessions and blocks new commerce, trials, renewal, downloads, key reveal, and activation while preserving commercial and legal history.
- Added durable idempotent `StorageCleanupJob` records, retry/backoff, abandoned-worker recovery, manual processing, and staged product finalization. Artifact replacement/removal now queues old-object cleanup after the active database reference is safe.
- Added explicit account capabilities. Plain members no longer see broad orders, invoices, payments, subscriptions, or unassigned licenses. Billing and license-management duties are separated server-side.
- Added the forward-only `20260803180000_data_integrity_safe_deletion` migration. It is applied to development; certification remains pending.
- Final retention periods and legal sufficiency remain Phase 6.7 decisions. Full Phase 6.1 verification and owner approval remain required before commit.

Phase 5.2 public Cloudflare-to-local routing, canonical runtime configuration, genuine Resend direct/registration/outbox delivery, and real PayMongo test checkout creation are verified. Genuine payment/webhook/refund/reconciliation certification remains open.

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
- Administrator security dashboard with own-session administration, retained revocation state, normalized event catalog, conservative review signals, provider-security history, and deduplicated security notifications

## In progress

- Phase 6.1 is the active uncommitted owner-review phase. Its implementation verification passes at 18 migrations, 125 deterministic tests plus six credential-gated skips, and 9 browser tests in both local and certification environments. Do not begin Phase 6.2 until the owner approves and commits it.
- Genuine PayMongo payment, webhook, refund, and reconciliation certification
- Production infrastructure selection and provisioning

## Deferred

- Automated refund initiation, accounting-grade revenue, BIR integration
- Public rendering pipeline for uploaded product imagery
- Bulk administration actions and advanced analytics

## Known issues and technical debt

- Customer and administrator license-key reveal is repeatable, ownership/RBAC protected, audited, and requires recent authentication; administrator access also requires email-code verification or a recovery code. Retaining encrypted key material remains a design risk requiring continued review.
- Artifact replacement deletes the old object best-effort after the database switch; orphan cleanup should be scheduled.
- Audit CSV is capped at 5,000 rows and should move to queued exports at scale.
- Search uses database substring matching; dedicated search is deferred.
- Permanent customer deletion intentionally removes orders, payments, invoices, licenses, and personal data. Production use remains blocked until legal, tax, accounting, privacy, and backup-retention requirements approve that policy.

## Future improvements

Approval workflows, queued exports, malware scanning/code signing, automated security-retention jobs, accounting integration, and richer organization administration.
# Flexible discount and customer-offer status

Implemented locally: general promotions, account-specific offers, administrative adjustments, exact integer pricing, annual-catalog separation, immutable order/subscription snapshots, finite monthly promotional cycles, serialized redemption limits, explicitly authorized zero totals, admin controls, checkout selection, audit records, and integration coverage. Migration `20260731025700_flexible_discount_offers` has been applied to the local development PostgreSQL database. See `discount-offers.md`.

Credential-gated PayMongo sandbox and Resend delivery certification remain external blockers. Abandoned offer reservations remain consumed until a future provider-aware finality/release job is designed and verified.
# Infrastructure status — August 2026

`jl-bke.com` is the canonical domain, Cloudflare is authoritative DNS, Namecheap is the registrar, and Resend has verified the sending domain. A named Cloudflare Tunnel currently exposes the owner's local Docker/Caddy stack over public HTTPS for certification only. No VPS deployment exists.
# Phase 5.2C status

Encrypted provider persistence, runtime resolution, PayMongo/Resend adapter integration, admin controls, validation, replacement/revocation, migration, and focused tests are implemented. Database-source activation is not complete until the owner rotates credentials and repeats genuine provider certification.

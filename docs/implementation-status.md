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

## Phase 6.1 — Data Integrity and Safe Deletion (committed and pushed)

- Replaced customer hard deletion with suspension, closure/reopen, privacy review, legal hold, pseudonymization, purge eligibility, and deliberately constrained final purge.
- Closure revokes sessions and blocks new commerce, trials, renewal, downloads, key reveal, and activation while preserving commercial and legal history.
- Added durable idempotent `StorageCleanupJob` records, retry/backoff, abandoned-worker recovery, manual processing, and staged product finalization. Artifact replacement/removal now queues old-object cleanup after the active database reference is safe.
- Added explicit account capabilities. Plain members no longer see broad orders, invoices, payments, subscriptions, or unassigned licenses. Billing and license-management duties are separated server-side.
- Added the forward-only `20260803180000_data_integrity_safe_deletion` migration. It is applied to development and certification.
- Phase 6.1 is committed at `952e9e1`. Final retention periods and legal sufficiency remain Phase 6.7 decisions.

## Phase 6.2 — PayMongo lifecycle certification (partially certified)

- Lifecycle code and migration 19 are committed at `a43cfc5`; the commit message overstated completion.
- Genuine Test Mode checkout, signed paid settlement, payment retrieval, persisted reconciliation, full refund, signed refund settlement, and transactional access revocation pass.
- Deterministic PostgreSQL integration tests cover failed payment, duplicate/conflicting replay, delayed occurrence, out-of-order settlement, duplicate refund, mismatch rejection, and idempotent effects.
- Genuine failed hosted checkout and PayMongo Dashboard resend evidence for duplicate, delayed, and out-of-order deliveries remain open. Live payments remain disabled.
- Caddy access logs now delete `Paymongo-Signature`; raw webhook bodies and provider credentials are not retained.
- Genuine duplicate `payment.paid` and `payment.refunded` dashboard redeliveries returned HTTP 200 and produced no duplicate payment, invoice, entitlement, email, or audit effects.
- Genuine failed, delayed, out-of-order, and raw-fixture cases remain explicitly not provider-certified; deterministic integration coverage remains.

## Phase 6.3 — Scheduler and lifecycle automation (committed and pushed)

- Migration 20 adds `ScheduledJobDefinition` and `ScheduledJobRun` with execution status, retry, timing, correlation, acknowledgement, and bounded summaries.
- Eight typed jobs cover storage, outbox, renewals, expiration, commerce, customer review, authentication cleanup, and payment operations.
- Valkey ownership-token locks prevent concurrent execution; unique run idempotency keys and domain constraints remain the final safety boundary.
- Docker runs one internal scheduler tick per minute. Administrators with MFA and recent authentication can inspect, run, dry-run, pause, resume, retry, and acknowledge.
- Focused unit/integration tests pass 9/9 and focused Playwright passes 1/1. Local and certification Vitest pass 140 with 6 credential-gated skips; local and certification Playwright pass 10/10. Production and Docker app/scheduler builds, migration 20, zero schema drift, certification smoke/readiness/eight-job health, repository hygiene, and the zero-vulnerability runtime audit pass.
- Committed at `099fe7c`; the subsequent Prisma interactive-transaction serialization fix is committed at `66f9fdd`.

## Phase 6.4 — Backup and disaster recovery (implemented repository work)

- Migration 21 adds durable encrypted archive and operation history.
- A dedicated worker creates compressed PostgreSQL and private-object archives, verifies SHA-256 and AES-256-GCM integrity, detects missing source objects, recovers abandoned work, and performs bounded retry.
- Daily/weekly/monthly retention, restore simulation, isolated-target restore, administrator history/actions, and two centralized scheduler jobs are implemented.
- Environment secrets, master keys, cloud/API credentials, and Valkey cache are excluded. Provider configuration is present only as the ciphertext already stored in PostgreSQL.
- TypeScript, ESLint, build, Docker, hygiene, and dependency checks are rerun per current verification environment; provider and restore evidence remain separately gated.
- A genuine certification archive correctly detected five database-referenced objects missing from certification MinIO and refused verification/restore. The incomplete ephemeral-key test archive was removed. Certification object drift must be repaired before a complete archive and restore simulation can pass.

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

- Complete the remaining owner-interactive Phase 6.2 failed-payment/delayed/out-of-order evidence when practical; it does not block the approved Phase 6.3 scope.
- Complete Phase 6.4 full verification and an isolated restore drill, then obtain owner review. Do not begin Phase 6.5 automatically.
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
- Governed customer purge preserves required historical commerce and legal evidence. Final retention periods still require legal, tax, accounting, privacy, and backup-policy approval.

## Future improvements

Approval workflows, queued exports, malware scanning/code signing, automated security-retention jobs, accounting integration, and richer organization administration.
# Flexible discount and customer-offer status

Implemented locally: general promotions, account-specific offers, administrative adjustments, exact integer pricing, annual-catalog separation, immutable order/subscription snapshots, finite monthly promotional cycles, serialized redemption limits, explicitly authorized zero totals, admin controls, checkout selection, audit records, and integration coverage. Migration `20260731025700_flexible_discount_offers` has been applied to the local development PostgreSQL database. See `discount-offers.md`.

Credential-gated PayMongo sandbox and Resend delivery certification remain external blockers. Abandoned offer reservations remain consumed until a future provider-aware finality/release job is designed and verified.
# Infrastructure status — August 2026

`jl-bke.com` is the canonical domain, Cloudflare is authoritative DNS, Namecheap is the registrar, and Resend has verified the sending domain. A named Cloudflare Tunnel currently exposes the owner's local Docker/Caddy stack over public HTTPS for certification only. No VPS deployment exists.
# Phase 5.2C status

Encrypted provider persistence, runtime resolution, PayMongo/Resend adapter integration, admin controls, validation, replacement/revocation, migration, and focused tests are implemented. Database-source activation is not complete until the owner rotates credentials and repeats genuine provider certification.
## Phase 6.5 — Monitoring and observability (implemented)

The observability dashboard, typed metrics endpoint, and internal alert model are implemented. Migration 22 is current in development and certification. TypeScript, ESLint, Prisma validation/generation, Vitest 155/6 skipped, Playwright 11/11, production build, Docker builds, runtime health checks, and repository hygiene passed. Phase 6.4 recovery certification remains pending. Phase 6.6 security hardening verification is the current work.

## Phase 6.6 — Operations and security hardening (verification)

Existing CSP/HSTS and browser-policy headers, secure session cookies, origin/CSRF checks, encrypted versioned provider credentials, MFA/recent-authentication gates, private one-time downloads, upload validation, Docker least-privilege settings, transactional database constraints, scheduler locks, encrypted backup manifests, and the Licensing Agent boundary were audited without redesign. Rate limits were added to observability, backup, backup-action, and download-grant endpoints. Full regression suites remain passing; external recovery certification and credential-gated provider evidence remain blockers to production readiness.

## Phase 6.7 — Legal, tax and compliance review (technical implementation)

Added `ComplianceRequirement` and immutable `ComplianceEvidence` records, seeded with explicit review states and exposed through `/admin/compliance`. Status/evidence mutations require administrator authorization, recent authentication, same-origin validation, rate limiting, and audit entries. Professional counsel, DPO/privacy, accountant/BIR, and regulatory review remain pending.

## Phase 6.8 — Secure software supply chain

Added CycloneDX SBOM and provenance scripts, release-linked `SupplyChainEvidence`, artifact hash manifests, administrator visibility at `/admin/supply-chain`, and audited status updates. Signing keys/certificates and malware scanning remain explicitly pending.

## Phase 6.9 — Production release management

Added release lifecycle stages, forward-only transition enforcement, approval records, evidence indicators, and Release Center visibility. Stable/LTS require explicit approval. Signing, malware, backup, compliance, and deployment gates remain separate.

Phase 6.12 remediation implements repository-side signed lease issuance, cryptographic supply-chain evidence, fail-closed release gates, separation of duties, grant retry recovery, and discoverable Compliance/Supply Chain administration. External Agent compatibility, production credentials, legal review, recovery certification, and Phase 6.10 remain pending.

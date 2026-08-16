# Implementation status

## Phase 3 — Product Verification & Supply-Chain Signing (implemented; owner review pending)

Supply-chain signing now runs as a protected server-side administrator operation.
The `SIGN` action constructs and signs a deterministic `bke.supply-chain.v1`
manifest containing product/version identity and sorted artifact identity, object
key, SHA-256, size, and content type. The server independently verifies its
signature through the trusted public-key resolver before persisting evidence.
`SUPPLY_CHAIN_SIGNING_PRIVATE_KEY` is separate from commercial lease signing,
never stored in PostgreSQL, accepted from clients, returned, or logged. Repeated
signing of unchanged state reuses matching evidence; artifact changes produce a
new manifest hash and cannot satisfy prior evidence. Legacy artifact-hash
verification remains historical and is not reinterpreted as a new manifest.

Stable/LTS gates consume matching canonical-manifest evidence while retaining
dependency, SBOM, provenance, malware, backup, compliance, migration, approval,
and separation-of-duties requirements. Production malware scanner provisioning,
certificate provisioning, and operational key rotation remain deferred.

## Phase 2 — Release and artifact lifecycle correction

Customer release selection now uses a canonical eligible-release resolver. Draft
or unpublished versions cannot clear the current stable/LTS release's `isLatest`
marker, and promotion updates latest state atomically for eligible releases.
Customer dashboards and download authorization require an active, published
stable/LTS version while retaining independent commercial entitlement checks.
Stored lease versions are never rewritten by release changes. Focused release
eligibility tests pass. Certification PostgreSQL Vitest passed 182 tests with 6
provider-gated skips, and Playwright passed 11/11. The production build was
blocked by the execution sandbox's Turbopack port permission; no Phase 2 code
failure was observed.

## Certification backup source-object cleanup — 2026-08-12

The missing-object evidence was traced to twelve archived inactive `delete-*`
products left by product-deletion integration fixtures. Their artifact keys were
`tests/...zip`; none existed in certification MinIO. The seeded
`installers/bke-installer.bin` was present. Certification-only cleanup removed only
the twelve orphan `ProductArtifact` rows and preserved historical commerce,
licensing, and audit records. No production storage or database was modified.

The backup implementation uses the exact database object key, including its file
extension, for primary-storage checks and manifest entries. Certification CREATE,
VERIFY, and SIMULATE_RESTORE subsequently passed with zero missing objects.
Isolated restore targets were provisioned and safety-validated. RESTORE_ISOLATED
passed against the certification archive; the restored database and 16 source
objects matched the manifest. Production RPO/RTO evidence remains pending.

## Production self-hosted MinIO bootstrap remediation — certified

The first VPS deployment revealed that a fresh MinIO instance was not deterministically initialized, which could leave the application bucket and least-privilege identity missing. `minio-init` now performs bounded, idempotent bucket creation, private-policy reconciliation, application-user reconciliation, and fail-closed authorization checks. The application identity is restricted to the configured bucket; broader direct policies and inherited/group permissions are rejected. MinIO root credentials are supplied only to MinIO and the initializer, never to application, scheduler, backup, proxy, database, or cache services. Runtime tests execute the real shell initializer against disposable MinIO/`mc` infrastructure and production Compose credential-boundary assertions.

Final certification: MinIO integration 5/5, certification Vitest 178 passed with 6 credential-gated skips, Playwright 11/11, TypeScript, ESLint, Prisma generate/validate, production build, Compose validation, repository hygiene, conflict scan, and `git diff --check` passed. VPS deployment, secrets, and reboot evidence remain owner-controlled Phase 6.10 work.

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
- PayMongo LIVE is owner-verified and operational. Unusual failed, delayed, and out-of-order provider scenarios remain separate evidence items. The certification mock path is repository-only and does not gate the Selling MVP.
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

Added CycloneDX SBOM and provenance scripts, release-linked `SupplyChainEvidence`, artifact hash manifests, administrator visibility at `/admin/supply-chain`, and audited status updates. Repository-controlled Phase 6.8 controls now include fail-closed publication evaluation for current signatures, checksums, per-artifact malware scan history, quarantine markers, emergency revocation, compromised-release markers, and audit timestamps. The admin supply-chain endpoint can rescan current private artifact bytes and record quarantine, emergency revocation, and compromise evidence without touching external certificates or production ClamAV. Production signing certificates and live ClamAV certification remain pending external provisioning.

## Phase 6.9 — Production release management

Added release lifecycle stages, forward-only transition enforcement, approval records, evidence indicators, and Release Center visibility. Stable/LTS require explicit approval. Signing, malware, backup, compliance, and deployment gates remain separate.

Phase 6.12 remediation implements repository-side signed lease issuance, cryptographic supply-chain evidence, fail-closed release gates, separation of duties, grant retry recovery, and discoverable Compliance/Supply Chain administration. External Agent compatibility, production credentials, legal review, recovery certification, and Phase 6.10 remain pending.

Phase 4 malware/artifact security pipeline is implemented at the repository boundary: current private artifact bytes are scanned, per-artifact evidence is bound to the canonical manifest hash, failures are fail-closed, and multi-artifact releases require every artifact to be CLEAN. ClamAV deployment and live production certification remain operational follow-up work.

Production Compose now includes a private, health-gated ClamAV service with no
published scanner port. The application uses the configured `clamav` TCP
adapter and bounded timeout semantics; VPS provisioning and production
CLEAN/INFECTED certification remain owner actions.

Trusted-release readiness now requires current payload-hash-bound SBOM and
provenance verification evidence, not merely non-null metadata fields. Real
shipping-candidate generation and commercial signing remain owner/VPS actions.
## Current status synchronization (RM5)

RM1 licensing, RM2 supply-chain controls, RM3 release governance, and RM4
download/OTP reliability controls are implemented locally. Latest full-suite,
production Docker, external provider, restore, VPS, and professional review
evidence remains pending. See `TRUTHCHECK.md` for the authoritative matrix.
### RM7 — Repository Certification Corrections

Committed and implemented. Static verification passes; database, Docker, and
browser execution remain environment-dependent.

### RB1A — Renewal integration

Partially resolved in repository code: confirmed renewal settlement now extends
the existing subscription/license exactly once and records an idempotent,
evidence-linked `RENEWAL` commercial lease operation with early/expired renewal
expiry semantics. Lease issuance for an active installation remains performed by
the shared commercial issuance service; full PostgreSQL webhook certification is
environment-dependent. No customer-facing renewal UI was added.

### RB1B — Transfer integration

Partially resolved: administrator-approved transfers now validate the exact
purchased order-item policy, require explicit target installation/device values,
record an evidence-linked `TRANSFER` operation, release predecessor commercial
activations, and preserve audit history. Full successor lease issuance and
PostgreSQL replay certification remain environment-dependent.

### RM8 — Commercial signing registry

Partially implemented: the dedicated registry, private-key reference boundary,
bootstrap helper, historical public-key publication, and single-active-key
constraint are present. Lease issuance still resolves the configured environment
key; administrator rotation and PostgreSQL certification remain pending. Normal
lease issuance is registry-only after bootstrap and records the registry key ID.

RM8C rotation is implemented with administrator recent-authentication/MFA,
same-origin validation, rate limiting, Ed25519 key matching, single-active-key
enforcement, durable idempotent operations, and historical retired-key
publication. PostgreSQL concurrency certification remains pending.

### RB1C — Refresh integration

Partially resolved: refresh requests validate the exact lease-history binding,
create durable idempotent `REFRESH` operations, and delegate successor issuance
to the shared commercial lease service. PostgreSQL concurrency certification and
no-change refresh reuse remain pending.

RM7F refresh semantics now reuse an active, unexpired lease without creating a
generation, while replacement refreshes retain operation idempotency. Revocation
operations now complete with predecessor evidence and explicit refusal status.
Renewal successor issuance and transactionally authoritative transfer remain
repository blockers pending a prepare/finalize or outbox implementation.

### RB1D — Revocation replacement integration

Partially resolved: administrator revocation now creates an idempotent,
evidence-linked `REVOCATION_REPLACEMENT` operation, deactivates commercial
activations, preserves lease history, and prevents further active lease issuance.
The protocol uses refusal semantics rather than a revoked active successor
lease. PostgreSQL replay and rollback certification remain pending.

RM7G transfer finalization now follows a durable prepare/issue/finalize boundary.
Bound renewals now collect server-owned active lease bindings after entitlement
settlement and invoke the shared issuance service; no-binding renewals remain
terminal with `ENTITLEMENT_RENEWED_NO_ACTIVE_INSTALLATION`. Issuance failures
leave prepared operations retryable without rolling back payment settlement.

RM7H completes source-predecessor transfer lifecycle, material refresh comparison,
bounded prepared-renewal recovery, immutable rotation replay checks, and atomic
rotation audit evidence.

Phase 3 certification is PASS: live server-side Ed25519 signing, independent
verification, artifact mutation invalidation, re-signing, repeat-sign idempotency,
authorization controls, publication signing evidence, and private-key non-exposure.

Phase 4 certification update: the real certification admin/API flow passed a
harmless CLEAN scan and standard EICAR INFECTED scan through private MinIO and
ClamAV. This is certification-only evidence; production scanner deployment and
remaining failure/mutation/aggregation scenarios remain pending.
### Phase 4 multi-artifact workflow

Administrator artifact addition is supported at `POST /api/admin/versions/:id/artifacts`. The operation uploads to private storage, computes SHA-256 server-side, invalidates release integrity state, and records an audit event. Current malware publication requires matching CLEAN evidence for every active artifact.
### Phase 5 Admin Control Plane

Phase 5 implementation adds a release detail control surface with artifact add/remove controls, current release-readiness reporting, evidence visibility, and a restricted commercial signing-key registry view. Server-side release predicates and security boundaries remain authoritative; deployment secrets and private keys remain outside Admin.
Phase 5 continuation adds read-only subscription and scanner status surfaces, explicit restore/delete confirmations, and safer guided license transfer/reveal controls. Backup operations remain durable-worker authoritative; UI work does not expose deployment secrets or private keys.

Phase 5 certification closure passed in the rebuilt certification environment: the
Docker stack was healthy, live/readiness endpoints returned 200, certification
Vitest completed with 187 passed and 6 credential-gated skips, the Phase 5
control-plane Playwright checks passed 2/2, and TypeScript, ESLint, Prisma
validation, security hygiene, and `git diff --check` passed. The scanner page now
uses a live ClamAV health probe rather than inferring availability from historical
evidence. Production provider credentials, VPS deployment, and production scanner
provisioning remain external work.
## Phase 5.5 — Production authentication and provider resilience

Phase 5.5 is certified in the owner-provided certification runtime. Normalized
email failure taxonomy, sanitized outbox/audit evidence, fail-closed MFA
delivery, provider delivery observability, recovery-code status/UX, and
non-exposure controls passed. Certification Vitest completed with 194 passed
and 6 credential-gated skips; Core Playwright passed 11/11, Phase 4 passed 2/2,
and Phase 5 control-plane plus scanner lifecycle checks passed. TypeScript,
ESLint, Prisma validation, security hygiene, and `git diff --check` passed.
Production provider credentials and deployment certification remain external.
## Phase 5.6 — Administrator emergency recovery

PASS in certification: `npm run admin:recover-mfa` reset a disposable existing
administrator's MFA state, recovery codes, challenges, and sessions atomically;
preserved the password and role; recorded sanitized operator/reason evidence;
and forced fresh MFA enrollment. Unknown-admin rejection and repository
validation passed. The command is deployment-only and is not an authentication
bypass.

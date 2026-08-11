# Engineering handoff

Commercial lease signing consumes the `CommercialSigningKey` registry. Environment
signing variables are bootstrap-only; later issuance requires exactly one ACTIVE
key and a resolvable `env:` private-key reference. Private material is never
stored in PostgreSQL or returned by APIs.

## Current closeout — self-hosted MinIO remediation

The first VPS deployment exposed a deterministic-initialization failure for private MinIO. The repository now starts the one-shot `minio-init` prerequisite before app and backup-worker services, creates the configured private bucket, reconciles bucket-scoped application credentials, and fails closed for broader direct or inherited/group permissions. Root credentials are limited to `minio` and `minio-init`; application services receive only filtered S3 credentials. The actual initializer is covered by disposable runtime tests (clean bootstrap, idempotent rerun, broader direct-policy rejection, and group/inherited rejection). Final evidence is MinIO 5/5, certification Vitest 178 passed/6 credential-gated skipped, Playwright 11/11, and passing static/build/Compose/hygiene checks. Pull the resulting commit on the VPS and follow `docs/vps-production-deployment.md`; this report does not claim deployment or reboot certification.

Commercial key rotation uses the administrator endpoint with a validated `env:`
reference. The old key becomes RETIRED and remains published for verification;
the successor becomes the only ACTIVE key.

RM7F status: refresh no-change reuse and terminal revocation evidence are
implemented. Renewal successor issuance and transfer finalization still require
completion before lifecycle certification.

## Active handoff — Phase 6.4 owner review

Phase 6.0 runtime parity is committed and pushed at `4f5a65a`. Use `certification-runtime.md` for the authoritative startup/test sequence and `runtime-parity.md` for environment, Docker, database, health, and provider boundaries. Full Vitest (116 passed, 6 credential-gated skipped), Playwright (9 passed), local/Docker production builds, 17-migration status, seed, smoke, readiness dependency outages, and the zero-vulnerability runtime audit passed. This is not PayMongo lifecycle certification or overall production readiness.

Administrator password-plus-email-code verification is committed and pushed at `1cdec97`. Migrations `20260803090000_admin_email_otp` and `20260803140000_admin_email_otp_hash` are applied in certification. Recovery codes remain the offline fallback; customer authentication is unchanged. The earlier Phase 5.1 TOTP design is a superseded historical implementation.

Phase 6.1A Legal Document Management is committed and pushed at `7763dd0`, with consent and navigation hardening at `e5c94f7`. Both legal migrations are applied and the idempotent seed creates nine placeholder documents. Replace and professionally approve every placeholder before public commerce.

The homepage pricing fix is committed at `05cefcb`. Phase 6.1 is committed at `952e9e1`. Phase 6.2 lifecycle code and migration 19 are committed, and current evidence is at `2bc8e82`. Genuine duplicate paid/refund dashboard redeliveries pass. Phase 6.3 is committed at `099fe7c`, with its PostgreSQL client-serialization correction at `66f9fdd`. The current uncommitted working tree implements Phase 6.4 and migration 21; development and certification schemas are current.

Phase 6.1 removes the legacy destructive customer route, adds governed lifecycle and retention controls, preserves legal/commercial evidence, adds account capabilities, and stages private-object deletion through durable cleanup jobs. Review `data-retention.md`, `customer-account-closure.md`, `privacy-deletion-workflow.md`, `storage-cleanup-jobs.md`, and the Phase 6.1 report before operating these controls.

Key entry points are `/admin/legal`, `/legal/[slug]`, `/legal/accept`, `lib/legal/`, and the three legal documentation files. Publication requires a recent MFA-verified administrator session. Database triggers—not only route checks—protect published content and acceptance rows. Because acceptance evidence intentionally restricts deletion of its related user/account/version, any later governed erasure design must preserve or legally reconcile those records rather than bypassing the triggers.

Phase 6.3 provides eight original lifecycle jobs, PostgreSQL run history, Valkey locks, restart recovery, bounded retry/backoff, the Docker scheduler worker, administrator controls, and separate scheduler health. Phase 6.4 adds two backup jobs, durable archive/operation history, encrypted PostgreSQL and private-object archives, verification, retention, and isolated restore controls. Current code verification passes TypeScript, ESLint, Vitest 155 passed with 6 credential-gated skips, Playwright 11/11, production build, and Docker target builds. Certification migration 21 and smoke checks pass. A genuine certification archive correctly stopped as incomplete because five database-referenced source objects are missing from MinIO; repair that drift and complete an isolated restore drill before approving Phase 6.4 for production. Never commit `.env.certification`, tunnel credentials, provider secrets, webhook payloads, signatures, backup keys, or restore credentials. Do not begin Phase 6.5.

## Phase 5.0 deployment foundation

Phase 5.0 adds centralized deployment-environment validation, environment-specific Valkey prefixes and private buckets, live/ready health routes, structured redacted operational logging, a Next.js standalone non-root image, a private PostgreSQL/Valkey/optional-MinIO Compose topology, Caddy HTTPS termination, one-shot migration tooling, repository hygiene checks, and CI enforcement. See `docs/deployment-foundation.md` and the Phase 5.0 report. No schema migration was required.

The repository baseline remains mixed: Phase 4.2 is committed at `25c6b41`, while its maintainability corrections, branding/authentication UX, permanent customer deletion, documentation, and a trial-state correction were already staged before Phase 5.0. Phase 5.0 did not edit those staged files except that existing mixed documentation could not be synchronized. Separate or commit that prior work before creating the Phase 5.0 commit.

Phase 5.1 is the historical TOTP-based security foundation committed at `d0909f7`; its authenticator flow was superseded by administrator email-code verification at `1cdec97`. Recovery codes, recent authentication, hardened sessions/bootstrap, and security events remain. Full PayMongo lifecycle certification, malware scanning, monitoring, backup/restore certification, legal/tax work, and launch remain deferred to their assigned gates.

## Project overview

BKE Digital Solutions is a Next.js 16 commerce, licensing, and private software-delivery platform backed by PostgreSQL/Prisma, Valkey, S3-compatible storage, PayMongo abstraction, and Resend abstraction.

## Flexible discount and customer-offer layer

The additive offer implementation is documented in `docs/discount-offers.md` and `docs/phase-reports/flexible-discount-and-customer-offers.md`. Migration `20260731025700_flexible_discount_offers` must be deployed before this application code. It preserves the annual catalog rule, accepts only account/plan/offer identifiers at checkout, snapshots all pricing, serializes limited redemption, supports finite monthly promotional cycles, and keeps private offers account-isolated. Pending offer reservations are conservative and remain consumed because delayed verified payments are supported.

## Phase 4.2 historical repository baseline

Phase 4.2 is implemented and locally verified on top of the committed Phase 4/4.1 baseline. It adds editions and multi-plan commerce without replacing authentication, payment providers, historical Price/LicensePolicy rows, or immutable commerce records. The implementation is included in the Phase 4.2 commerce commit.

## Folder structure and important files

- `app/admin/`: administration centers and detail pages
- `app/api/admin/`: RBAC-protected mutation and export routes
- `components/admin-*`: tables, navigation, actions, product and artifact forms
- `lib/auth.ts`, `lib/authorization.ts`, `lib/audit.ts`: security boundaries
- `lib/webhooks.ts`, `lib/licensing.ts`, `lib/storage.ts`, `lib/email.ts`: commerce services
- `prisma/schema.prisma`: domain model; migrations are append-only under `prisma/migrations/`
- `tests/e2e/admin-product.spec.ts`: primary administration browser workflow
- `lib/pricing.ts`, `lib/edition-plans.ts`: authoritative annual calculations and edition/plan writes
- `tests/integration/multi-plan.test.ts`: perpetual/monthly/annual database lifecycle coverage
- `lib/trials.ts`, `tests/integration/trials.test.ts`: account/product/year eligibility, transactional issuance, grace, revocation, and concurrency
- `app/api/orders/[id]/continue/route.ts`, `components/pending-order-actions.tsx`: pending checkout recovery and cancellation UI

## New APIs

- `PATCH /api/admin/customers/:id`
- `PATCH /api/admin/devices/:id`
- `PATCH /api/admin/orders/:id`
- `POST /api/admin/invoices/:id/email`
- `GET /api/admin/audit/export`
- `PATCH|DELETE /api/admin/artifacts/:id`
- `POST /api/admin/products/:id/image`
- Extended product, version, and license admin APIs
- `GET|DELETE /api/admin/products/:id/deletion` for deletion preview and guarded permanent deletion
- `POST /api/admin/products/:id/editions` and `PATCH /api/admin/editions/:id`
- `POST /api/checkout` accepts exactly `{ purchasePlanId, customerAccountId, offerIdentifier? }`; all pricing and eligibility remain server-owned.
- `POST /api/admin/offers` and `PATCH /api/admin/offers/:id` create and control audited offers.
- `POST /api/orders/:id/continue` reuses or replaces a pending hosted checkout for authorized owners/billing roles
- `POST /api/trials`, `POST /api/admin/trials`, and `PATCH /api/admin/trials/:id`

All mutations require an administrator session, same-origin validation, Zod validation where payloads are present, and audit logging.

Phase 4.1 adds `lib/product-deletion.ts` as the reusable eligibility/deletion service and `components/admin-product-delete.tsx` as the archived-only typed confirmation UI. Do not add a force-delete path. Historical products must remain archived. Storage deletion is performed only after the locked eligibility recheck; a cleanup failure keeps the database product and returns a retryable redacted failure.

## Database changes

Migration `20260730161141_platform_administration` adds customer suspension, product category/license type/featured/image/tags, release channel/changelog/deprecation, artifact download/removal metadata, and device platform/last-seen metadata.

Phase 4.1 required no schema change or migration.

Migration `20260730174924_product_editions_multi_plan` adds Edition/PurchasePlan, entitlement links, and order-item plan snapshots. It backfills catalog links without changing historical amounts, invoice/payment rows, dates, or statuses. The seed reuses migration-created legacy mappings and is idempotent.

Migration `20260731103000_pending_order_resume` adds nullable server-only checkout URL storage to payment attempts. Migration `20260731113000_product_trials` adds trial source/history with restrictive product, edition, account, and license relations plus a unique self-service account/product/year boundary. These migrations are forward-only; rollback requires application shutdown, a verified backup, and explicit data-retention decisions rather than dropping populated history.

Migration `20260731025700_flexible_discount_offers` adds discount definitions, redemption reservations, pricing snapshots, renewal-order linkage, recurring promotional-cycle state, database checks, and restrictive historical relations. Product deletion now treats scoped offers/redemptions as blockers; permanent customer deletion removes account offers/redemptions before commerce rows.

## Environment and manual configuration

Existing `DATABASE_URL`, Redis, S3, session/MFA/license secrets, PayMongo, Resend, and cron variables remain required as documented in the environment examples. The official domain is `jl-bke.com`, Cloudflare is authoritative DNS, Namecheap is the registrar, and Resend has verified the sending domain. No VPS has been deployed. Owner action is still required for PayMongo test credentials, credential-gated Resend delivery evidence, production storage/IAM, VPS provisioning, public HTTPS validation, backups, and monitoring.

## Known limitations and future work

See `implementation-status.md`, `ROADMAP.md`, the deployment checklist, and the Phase 4 report. Do not promote the local development administrator or mock-provider configuration to production.
# Phase 5.2C handoff

Keep provider source on `environment` until newly rotated PayMongo TEST and Resend credentials have been saved, validated, and enabled with an externally managed master key. Then select `database`, restart, and rerun provider certification. Never copy current environment values automatically. See `docs/operations/provider-credential-rotation.md`.

# Phase 5.3 handoff

Migration `20260802143000_security_dashboard_sessions` must be deployed before this application version. It adds retained session revocation metadata, safe client/network summaries, authentication method and assurance, normalized security-event outcome/severity/provider context, supporting indexes, and an email-outbox deduplication key. `/admin/security` is self-service only: administrators cannot inspect or revoke another administrator's sessions. No automated retention purge is enabled; approve policy and backup interaction before adding one.
## Phase 6.5 handoff

Monitoring and observability are verified over existing services. Review `docs/observability.md`. Migration 22 is current in development and certification. The metrics endpoint correctly reports CRITICAL for the incomplete Phase 6.4 recovery point. Phase 6.6 audited and tightened operational security without changing the frozen Licensing Agent boundary; review `docs/phase-reports/phase-6.6-operations-security-hardening.md`. Complete recovery certification and external provider evidence before release.

## Phase 6.7 handoff

The technical compliance register is available at `/admin/compliance`. It records evidence and explicit pending review states; it does not grant legal, privacy, tax, BIR, or regulatory approval. Obtain counsel, DPO/privacy, accountant, and regulatory decisions before production launch.

## Phase 6.8 handoff

Supply-chain evidence is linked to product versions and visible at `/admin/supply-chain`. SBOM/provenance generation is deterministic only when the build environment supplies release metadata. Certificate provisioning, detached signing, and malware scanning are intentionally pending.

## VPS deployment handoff

Use `docs/vps-production-deployment.md` for independent Ubuntu/Hetzner deployment. Compose restart policies are statically verified, but Docker boot configuration, Cloudflare DNS, credentials, and cold-reboot recovery require owner evidence and are not claimed here.

Phase 6.12 adds the commercial signed-lease issuer, evidence-backed supply-chain verification, fail-closed release gates, approval separation, and safe download grant recovery. Do not treat test signing/scanner evidence as production certification.

Licensing boundary correction: `/api/licenses/activate` returns only a signed lease and issuance metadata. Runtime authorization remains exclusively inside the separate Licensing Agent and reaches products only as `AuthorizationDecision`.
## Handoff status

Do not claim production readiness from repository implementation alone. Use
`TRUTHCHECK.md` as the current status source. Phase 6.10 VPS deployment is
deferred; production malware scanning, signing certificates, restore drills,
provider evidence, and legal/privacy/tax reviews remain outstanding.
### RM7 handoff

RM7 is committed. Lease lifecycle records are durable, release break-glass is
governance-only, and supply-chain signer identity is separate with trusted-key
history support. Run database-backed certification when PostgreSQL is available.

RM7G transfer retries reuse the prepared operation and issued lease before
finalizing ownership. Renewal settlement remains valid without an installation;
bound renewals now invoke successor issuance using existing lease-history
bindings, with prepared operations retained when signing fails.

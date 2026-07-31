# Engineering handoff

## Phase 5.0 deployment foundation

Phase 5.0 adds centralized deployment-environment validation, environment-specific Valkey prefixes and private buckets, live/ready health routes, structured redacted operational logging, a Next.js standalone non-root image, a private PostgreSQL/Valkey/optional-MinIO Compose topology, Caddy HTTPS termination, one-shot migration tooling, repository hygiene checks, and CI enforcement. See `docs/deployment-foundation.md` and the Phase 5.0 report. No schema migration was required.

The repository baseline remains mixed: Phase 4.2 is committed at `25c6b41`, while its maintainability corrections, branding/authentication UX, permanent customer deletion, documentation, and a trial-state correction were already staged before Phase 5.0. Phase 5.0 did not edit those staged files except that existing mixed documentation could not be synchronized. Separate or commit that prior work before creating the Phase 5.0 commit.

Phase 5.1 must not begin until owner review. PayMongo sandbox certification, Resend production delivery, malware scanning, external monitoring, backup/restore certification, legal/tax work, and launch remain deferred to their assigned gates.

## Project overview

BKE Digital Solutions is a Next.js 16 commerce, licensing, and private software-delivery platform backed by PostgreSQL/Prisma, Valkey, S3-compatible storage, PayMongo abstraction, and Resend abstraction.

## Flexible discount and customer-offer layer

The additive offer implementation is documented in `docs/discount-offers.md` and `docs/phase-reports/flexible-discount-and-customer-offers.md`. Migration `20260731025700_flexible_discount_offers` must be deployed before this application code. It preserves the annual catalog rule, accepts only account/plan/offer identifiers at checkout, snapshots all pricing, serializes limited redemption, supports finite monthly promotional cycles, and keeps private offers account-isolated. Pending offer reservations are conservative and remain consumed because delayed verified payments are supported.

## Current repository state

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

No new variables were added. Existing `DATABASE_URL`, Redis, S3, session/license secrets, PayMongo, Resend, and cron variables remain required as documented in `.env.example`. Owner action is still required for PayMongo test credentials, a Resend verified sender (or onboarding test sender), production storage/IAM, infrastructure, backups, and monitoring.

## Known limitations and future work

See `implementation-status.md`, `ROADMAP.md`, the deployment checklist, and the Phase 4 report. Do not promote the local development administrator or mock-provider configuration to production.

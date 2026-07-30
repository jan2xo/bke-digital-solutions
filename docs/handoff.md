# Engineering handoff

## Project overview

BKE Digital Solutions is a Next.js 16 commerce, licensing, and private software-delivery platform backed by PostgreSQL/Prisma, Valkey, S3-compatible storage, PayMongo abstraction, and Resend abstraction.

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
- `POST /api/checkout` now accepts exactly `{ purchasePlanId }`
- `POST /api/orders/:id/continue` reuses or replaces a pending hosted checkout for authorized owners/billing roles
- `POST /api/trials`, `POST /api/admin/trials`, and `PATCH /api/admin/trials/:id`

All mutations require an administrator session, same-origin validation, Zod validation where payloads are present, and audit logging.

Phase 4.1 adds `lib/product-deletion.ts` as the reusable eligibility/deletion service and `components/admin-product-delete.tsx` as the archived-only typed confirmation UI. Do not add a force-delete path. Historical products must remain archived. Storage deletion is performed only after the locked eligibility recheck; a cleanup failure keeps the database product and returns a retryable redacted failure.

## Database changes

Migration `20260730161141_platform_administration` adds customer suspension, product category/license type/featured/image/tags, release channel/changelog/deprecation, artifact download/removal metadata, and device platform/last-seen metadata.

Phase 4.1 required no schema change or migration.

Migration `20260730174924_product_editions_multi_plan` adds Edition/PurchasePlan, entitlement links, and order-item plan snapshots. It backfills catalog links without changing historical amounts, invoice/payment rows, dates, or statuses. The seed reuses migration-created legacy mappings and is idempotent.

Migration `20260731103000_pending_order_resume` adds nullable server-only checkout URL storage to payment attempts. Migration `20260731113000_product_trials` adds trial source/history with restrictive product, edition, account, and license relations plus a unique self-service account/product/year boundary. These migrations are forward-only; rollback requires application shutdown, a verified backup, and explicit data-retention decisions rather than dropping populated history.

## Environment and manual configuration

No new variables were added. Existing `DATABASE_URL`, Redis, S3, session/license secrets, PayMongo, Resend, and cron variables remain required as documented in `.env.example`. Owner action is still required for PayMongo test credentials, a Resend verified sender (or onboarding test sender), production storage/IAM, infrastructure, backups, and monitoring.

## Known limitations and future work

See `implementation-status.md`, `ROADMAP.md`, the deployment checklist, and the Phase 4 report. Do not promote the local development administrator or mock-provider configuration to production.

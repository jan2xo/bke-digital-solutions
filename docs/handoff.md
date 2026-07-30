# Engineering handoff

## Project overview

BKE Digital Solutions is a Next.js 16 commerce, licensing, and private software-delivery platform backed by PostgreSQL/Prisma, Valkey, S3-compatible storage, PayMongo abstraction, and Resend abstraction.

## Current repository state

Phase 4 and Phase 4.1 extend the existing admin MVP without replacing authentication, commerce, licensing, customer portal, or payment providers. The combined administration and archived-product lifecycle implementation is locally verified and committed as one reviewed scope.

## Folder structure and important files

- `app/admin/`: administration centers and detail pages
- `app/api/admin/`: RBAC-protected mutation and export routes
- `components/admin-*`: tables, navigation, actions, product and artifact forms
- `lib/auth.ts`, `lib/authorization.ts`, `lib/audit.ts`: security boundaries
- `lib/webhooks.ts`, `lib/licensing.ts`, `lib/storage.ts`, `lib/email.ts`: commerce services
- `prisma/schema.prisma`: domain model; migrations are append-only under `prisma/migrations/`
- `tests/e2e/admin-product.spec.ts`: primary administration browser workflow

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

All mutations require an administrator session, same-origin validation, Zod validation where payloads are present, and audit logging.

Phase 4.1 adds `lib/product-deletion.ts` as the reusable eligibility/deletion service and `components/admin-product-delete.tsx` as the archived-only typed confirmation UI. Do not add a force-delete path. Historical products must remain archived. Storage deletion is performed only after the locked eligibility recheck; a cleanup failure keeps the database product and returns a retryable redacted failure.

## Database changes

Migration `20260730161141_platform_administration` adds customer suspension, product category/license type/featured/image/tags, release channel/changelog/deprecation, artifact download/removal metadata, and device platform/last-seen metadata.

Phase 4.1 required no schema change or migration.

## Environment and manual configuration

No new variables were added. Existing `DATABASE_URL`, Redis, S3, session/license secrets, PayMongo, Resend, and cron variables remain required as documented in `.env.example`. Owner action is still required for PayMongo test credentials, a Resend verified sender (or onboarding test sender), production storage/IAM, infrastructure, backups, and monitoring.

## Known limitations and future work

See `implementation-status.md`, `ROADMAP.md`, the deployment checklist, and the Phase 4 report. Do not promote the local development administrator or mock-provider configuration to production.

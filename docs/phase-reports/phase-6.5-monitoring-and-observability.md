# Phase 6.5 — Monitoring and Observability

Status: implementation complete in the repository; production/runtime certification remains pending.

## Delivered

- Shared typed metrics collector covering application, PostgreSQL, Valkey, object storage, scheduler, backups, payments, licensing issuance, email, security, and infrastructure.
- `/api/health/metrics` machine-readable health feed.
- `/admin/observability` administrator dashboard with health cards and drill-down metrics.
- Durable `ObservabilityAlert` model with severity, acknowledgement, resolution, timestamps, deduplication fingerprints, and audit events.
- Explicit preservation of the external Licensing Agent boundary: the platform reports lease issuance only.
- Payment, licensing, and email signals now include durable queue/reconciliation counts rather than only provider webhook or generic availability state.

## Verification status

- Development and certification both have 22 migrations applied; migration 22 created the alert table, enum types, indexes, and user foreign keys.
- Prisma validation, Prisma generation, TypeScript, ESLint, and `git diff --check` passed.
- Full Vitest passed: 155 passed, 6 credential-gated skipped.
- Full Playwright passed: 11/11.
- Production build passed.
- Production Docker builds passed for app, scheduler, and backup-worker.
- Certification `/api/health/live` and `/api/health/ready` returned HTTP 200. The metrics endpoint returned HTTP 200 and correctly reported `CRITICAL` because the previously incomplete backup recovery point remains present.
- Development PostgreSQL, Valkey, and MinIO containers are healthy. Certification PostgreSQL, Valkey, MinIO, and app containers are healthy; scheduler and backup-worker are running; Caddy is running.
- Repository hygiene passed for 473 tracked files.

The certification Compose smoke command could not run because the migrations-only image intentionally does not include `scripts/post-migration-smoke.ts`; the migration itself and direct database integrity inspection passed. Run smoke from the operations image before final release.

## Blockers

- Restore Phase 6.4 certification remains pending.
- The dashboard requires an authenticated administrator session for browser-level visual verification; the route was included and compiled, while API/runtime checks passed.
- Complete a certification operations-image smoke run and the previously pending Phase 6.4 recovery drill.
- External notification providers and infrastructure-level CPU/memory/TLS exporters remain deferred to a later operations integration.
- The endpoint remains a repository-owned signal feed, not proof of VPS uptime, TLS, provider delivery, restore RPO/RTO, or external Licensing Agent authorization. Those require owner-controlled production evidence.
- Current checkpoint adds request correlation propagation, no-store metrics responses, and recursive operational-log redaction for secrets, payloads, and email identifiers.

# Phase 6.3 — Scheduler & Lifecycle Automation

Status: implemented and fully verified in the uncommitted working tree; pending owner review. No commit or push was created.

## Executive assessment

Phase 6.3 replaces scattered time-based operations with eight compiled jobs, PostgreSQL definition/run state, Valkey ownership-token locks, unique scheduled-window idempotency, restart recovery, bounded retry/backoff, a dedicated Docker worker, administrator operations, CLI execution, and separate health reporting.

The implementation schedules existing safe storage cleanup, queues renewal and lifecycle notifications, synchronizes expired entitlement state, releases stale reservations, expires abandoned orders/attempts, reviews retention/legal holds without purge, cleans expired authentication/download records, retries only retryable stored webhooks, and creates reconciliation review reminders. It never automatically charges, settles, refunds, or purges.

## Database

Migration `20260804100000_scheduler_lifecycle_automation` adds run-status and trigger enums, `ScheduledJobDefinition`, `ScheduledJobRun`, indexes for due/backlog/recovery queries, acknowledgement linkage, and artifact creation timestamps. Abandoned uploads are processed only when an upload failure created an explicit cleanup record; artifact age or inactive draft status never authorizes deletion.

## Safety

- Valkey lock acquisition uses `SET NX PX`; release compares the owner token atomically.
- The lock TTL exceeds the handler timeout.
- Unique scheduled-window run keys reject duplicate dispatch.
- Domain transactions and idempotency keys remain authoritative.
- Results/errors are bounded and redacted.
- Public readiness is independent from scheduler health.
- Admin mutations require MFA, recent authentication, same origin, validation, rate limit, and audit.

## Verification to date

- Prisma generation and validation: passed.
- TypeScript and ESLint: passed after initial implementation corrections.
- Development migration 20: applied and current.
- Focused scheduler unit/integration: 9 passed.
- Focused scheduler Playwright: 1 passed.
- Initial focused unit attempt: failed before collection because `.env` was not loaded; corrected by using the repository test bootstrap.
- Full local Vitest: 140 passed, 6 credential-gated skipped.
- Full certification Vitest: 140 passed, 6 credential-gated skipped.
- Full local Playwright: 10/10 passed.
- Full certification Playwright: 10/10 passed.
- Production build: passed.
- Production app and scheduler Docker targets: passed.
- Prisma validation: passed; development schema drift: none.
- Migration 20: applied and current in development and certification; both post-migration smoke checks passed.
- Certification readiness: PostgreSQL, Valkey, object storage, and selected providers up.
- Certification scheduler health: healthy, eight registered jobs, zero consecutive failures and zero retry backlog at verification.
- Runtime dependency audit: zero vulnerabilities.
- Repository hygiene: passed for 424 tracked files.
- `git diff --check`: passed; no staged files.

The first production build attempt failed because the execution sandbox prohibited Turbopack's internal local port; the identical build passed with authorized local execution. The first full Playwright run exposed a pre-existing logout assertion race in the product-deletion test (409 arrived before logout completed); waiting for the login navigation made the test deterministic, after which both local and certification suites passed 10/10. The initial Docker command returned before BuildKit completed; the completed image was verified by digest and both app and scheduler targets passed. Certification also exposed an inherited web-server health check on the non-HTTP worker; `HEALTHCHECK NONE` now correctly leaves job health to `/api/health/scheduler`.

Historical status at the time of this report: Phase 6.4 had not started. Phase 6.4 has since been implemented in a separate uncommitted working tree; this Phase 6.3 report remains the immutable historical verification record for its own phase.

# Phase 6.5 — Monitoring and Observability

The platform health dashboard is available at `/admin/observability` for administrators with MFA and recent authentication. It consumes existing readiness, scheduler, backup, email, webhook, and security data; it does not duplicate payment, licensing-agent, scheduler, or backup business logic.

The reusable metrics endpoint is `GET /api/health/metrics`. It returns typed health cards for the application, PostgreSQL, Valkey, object storage, scheduler, backups, payments, licensing issuance, email, security, and infrastructure. Health is `HEALTHY`, `WARNING`, or `CRITICAL`. Payment metrics include retryable webhook failures, open reconciliation records, and pending checkout attempts. Licensing metrics include pending/failed commercial lease operations and licenses expiring within 30 days. Email metrics include failed/retrying and pending outbox records.

Internal `ObservabilityAlert` records support INFO/WARNING/ERROR/CRITICAL severities, acknowledgement, resolution, timestamps, history, and safe metadata. External notification delivery is intentionally deferred. Licensing metrics describe platform lease issuance only; the external Licensing Agent remains responsible for authorization and offline runtime state.

Recovery certification remains pending from Phase 6.4. Monitoring reports that state directly and does not mark incomplete backups healthy.

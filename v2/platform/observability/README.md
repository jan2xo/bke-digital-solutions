# V2 Platform — Observability

Observability is a host/platform aggregation seam.

## Ownership

Platform owns **HOW** publisher-supplied health cards are combined into a snapshot, how overall severity is derived, and how non-healthy cards create or refresh operational alerts.

Domains and other platform seams own **WHAT** they publish.

Application/runtime, database, cache, storage, scheduler, backup, payments, licensing, email, security, and other concrete health meanings must therefore be supplied through `ObservabilitySource` adapters. This seam does not query those domains or persistence models directly.

## Preserved V1 mechanics

- `HEALTHY`, `WARNING`, `CRITICAL` states
- overall state is the most severe card state
- every metric carries a shared observation timestamp
- non-healthy cards synchronize alerts
- alert fingerprint is `monitoring:<card-key>:<severity>`
- an existing active alert is refreshed rather than duplicated
- a new alert title is `<label> health is <state>`
- alert metadata carries the card metrics
- healthy cards do not create alerts

## Non-ownership

This seam does not:

- query Prisma or any domain persistence
- invent payment/licensing/email/security/backup thresholds
- own readiness or scheduler-health implementations
- own deployment/runtime environment discovery
- wire `/api/health/metrics` or ATTACK #6 host adoption
- modify production database schema or migrations

Publishers retain the meaning. Observability only aggregates and surfaces it.

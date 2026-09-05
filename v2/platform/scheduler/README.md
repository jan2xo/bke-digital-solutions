# V2 Platform Scheduler

`v2/platform/scheduler` owns reusable scheduling mechanics. It does not own the business jobs being scheduled.

## Boundary

Platform owns **HOW** work is scheduled and executed:

- cadence windows and scheduled idempotency keys
- registry validation and job lookup
- timeout enforcement
- distributed/in-memory locking contracts
- duplicate-run prevention through durable store semantics
- run lifecycle state transitions
- retry classification/backoff and terminal attempts
- abandoned-run recovery after restart
- due/retry selection orchestration
- enable/disable, acknowledgement, and explicit retry mechanics
- bounded persistence summaries and scheduler operational events

Domains own **WHY** work runs. Commerce, Entitlements, Email, Storage, Payments, Backup, Security, and other handlers are injected `ScheduledJob.handler` functions and must remain outside this folder.

## Explicit non-ownership

This seam intentionally does not import or own:

- V1 `lib/scheduler/*`, `lib/db.ts`, or global Prisma
- `@bke/*` domain packages
- `v2/modules/*` business logic
- root scripts, cron/API routes, or deployment scheduling
- domain job registry entries
- Redis/environment configuration selection

Durability enters through `SchedulerStore`. Lock backends enter through `SchedulerLockProvider`; a distributed adapter can be built over an injected backend, while the included memory adapter is suitable for isolated development/certification. Scheduler operational events leave through `SchedulerEventSink` and can be bridged to the V2 Audit seam by host composition.

## Preserved V1 mechanics

The extraction preserves V1 scheduling policy, including 30-second minimum cadence validation, lock TTL greater than timeout, max-attempt validation, windowed scheduled idempotency, bounded summaries, exponential retry delay capped at six hours, safe error codes, failure classification, skipped lock conflicts, timeout lock retention, abandoned-run recovery, and parent-linked retries.

## Adoption

This attack establishes and certifies the platform seam only. Replacing `lib/scheduler/*`, constructing the real domain job registry, implementing the durable store/Redis adapters, and retiring legacy cron/CLI entrypoints belong to the host-convergence/adoption lane.

# V2 Platform Health

`v2/platform/health` owns shallow liveness and reusable readiness aggregation.

## Boundary

Platform owns **HOW** required dependencies are probed, timed out, summarized, and safely reported. Each owning platform/domain supplies the actual probe operation.

This seam intentionally does not import or own:

- V1 `lib/health.ts`, `lib/db.ts`, or environment configuration
- Redis/Valkey clients, object-storage clients, provider configuration, or Prisma
- `@bke/*` domain capabilities or `v2/modules/*`
- HTTP route wiring
- scheduler-specific operational health reporting
- metrics, dashboards, historical telemetry, or observability aggregation

Liveness is deliberately shallow and dependency-free. Readiness is fail-closed and invokes all registered probes concurrently with a default three-second timeout. Failures expose only the dependency name and `DEPENDENCY_UNAVAILABLE`; raw exceptions are never emitted by the health platform.

## Preserved V1 readiness contract

The core BKE readiness helper preserves the existing dependency keys:

- `postgresql`
- `valkey`
- `objectStorage`
- `providers`

All four must report `up` for `ready: true`. A failed or timed-out probe remains `down`, while independent probes continue and report their own result. An optional correlation id is propagated only into the safe readiness failure event.

## Explicit exclusions

`/api/health/metrics` is Observability ownership and remains outside this seam. `/api/health/scheduler` is scheduler-specific operational reporting and is not folded into generic readiness. Those surfaces must not turn Health into a metrics or business-status subsystem.

## Adoption

This attack establishes and certifies the platform seam only. Host composition must later inject the real PostgreSQL, Valkey, object-storage, and provider probes and wire the existing live/ready HTTP routes. That adoption belongs to the host-convergence lane.

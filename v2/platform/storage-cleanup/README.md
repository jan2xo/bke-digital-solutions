# V2 Platform — Storage Cleanup

Storage Cleanup is host/platform infrastructure.

## Ownership

Platform owns **HOW** a previously-authorized deletion is queued, deduplicated, claimed, retried, recovered after abandoned processing, executed against object storage, and marked complete or terminally failed.

Domain capability owners own **WHY** an object may be deleted.

The platform therefore requires an injected `StorageCleanupEligibilityGuard`. It does not query Catalog, product artifacts, entitlements, licensing, orders, or any other domain directly.

## Preserved V1 mechanics

- SHA-256 idempotency over `type:targetId:objectKey`
- default 20-job batch, capped at 100
- 15-minute abandoned `PROCESSING` recovery to retry
- compare-and-swap style claim through the store port
- five-attempt terminal failure limit
- exponential retry delay starting at 30 seconds and capped at one hour
- object deletion only after an external eligibility decision
- safe failure codes derived from error class/name rather than raw messages
- explicit operational effects for retry request, success, retry scheduling, and terminal failure

## Non-ownership

This seam does not:

- decide whether Catalog artifacts, uploads, products, or other domain objects are deletable
- import `@/lib`, Prisma, `v2/modules`, or `@bke/*`
- own object-storage configuration
- own scheduler invocation
- persist audit/security events directly
- wire routes, cron, or ATTACK #6 host adoption
- modify production database schema or migrations

Host adoption supplies concrete persistence, object deletion, eligibility, and effect adapters later.

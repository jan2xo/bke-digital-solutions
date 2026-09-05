# V2 Platform Email

`v2/platform/email` owns host/platform mechanics for email transport and durable outbox dispatch.

## Boundary

Platform owns **HOW** an already-rendered email is delivered, claimed, retried, failed safely, and marked complete. Domain capabilities own **WHY** a communication exists and the subject/body semantics they emit.

This seam intentionally does not import or own:

- V1 `lib/email.ts`, `lib/db.ts`, or global Prisma
- any `v2/modules/*` business capability
- `@bke/*` domain packages
- HTTP/cron routes or scheduler invocation
- Commerce, Security, Support, Identity, Licensing, or other domain-specific email templates
- provider-configuration persistence or credential policy

The Resend adapter receives configuration through an injected resolver. An `EmailOutboxStore` adapter supplies durable claim/update operations. This keeps provider configuration and persistence ownership outside the transport seam.

## Preserved V1 mechanics

The generic dispatcher preserves the existing operational behavior:

- default batch size: 20
- default claim TTL: 5 minutes
- default maximum attempts: 5
- expired processing claims are recovered before selection
- only pending/failed rows below the attempt limit are dispatchable
- compare-and-swap claiming prevents duplicate workers from owning the same row
- losing a claim/update race counts as skipped rather than sent/failed
- outbox row id is the default provider idempotency key
- successful delivery increments attempts and marks sent
- failed delivery records only a safe failure category
- the fifth failed attempt becomes permanently failed
- dispatch exposes selected/recovered/sent/failed/terminal/skipped counters

Provider error bodies, raw credentials, and domain payload rendering do not belong in this surface.

## Adoption

This attack establishes and certifies the platform seam only. Production storage adapters, provider-configuration wiring, scheduler/cron invocation, and replacement of V1 `lib/email.ts` imports belong to their owning host-convergence lanes.

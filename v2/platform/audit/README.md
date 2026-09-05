# V2 Platform Audit

`v2/platform/audit` owns the host/platform mechanics for recording audit events.

## Boundary

Platform owns **HOW** audit records are sanitized and handed to durable persistence. Domain capabilities own **WHY** an audit event exists and the semantic action/target metadata they emit.

This seam intentionally does not import or own:

- V1 `lib/audit.ts` or `lib/db.ts`
- global Prisma
- any `v2/modules/*` business capability
- HTTP routes or presentation logic
- domain-specific audit event catalogs

A host composition root supplies an `AuditSink` that performs the actual durable insert. The platform `AuditPort` recursively redacts sensitive metadata before the sink sees the record.

## Preserved V1 behavior

Sensitive metadata keys matching password/passphrase/secret/token/API key/access key/private key/license key/authorization/cookie/signature/checkout URL/payload/request body patterns are replaced with `[REDACTED]`, including nested objects and arrays. Omitted metadata is normalized to `{}`.

## Adoption

This attack only establishes and certifies the platform seam. Production route/module adoption belongs to the host-convergence lane and must be wired separately after this adapter merges.

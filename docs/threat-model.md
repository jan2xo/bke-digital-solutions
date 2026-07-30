# Threat model checklist

- **Credential attacks:** Argon2id, generic login and magic-link responses, one-time expiring tokens, database sessions, revocation, and layered rate limits.
- **CSRF and request forgery:** SameSite cookies, canonical Origin validation on cookie-authenticated mutations, cron bearer secret, and independently signed webhooks.
- **XSS and clickjacking:** React escaping, no raw HTML rendering, nonce-based CSP, restricted framing, MIME and referrer policies.
- **Injection:** Zod boundary validation, Prisma parameterization, no dynamic raw SQL, sanitized download filenames.
- **Broken access control:** account-scoped queries, explicit membership ranks, global admin checks, and non-enumerating failures.
- **Payment fraud/replay:** raw-body signatures, timestamp tolerance, test/live binding, amount/currency/reference matching, unique external IDs, immutable snapshots, and transactional issuance.
- **License abuse:** keyed hashes, atomic activation caps, revocation, expiry checks, device identifier hashes, short-lived download URLs.
- **Secret leakage:** server-only environment parsing, no client secret variables, redacted audit metadata, private object storage, and committed example values only.
- **Availability:** request-size limits, distributed rate limits, provider timeouts, idempotent retry handling, and indexed access paths.

Before launch, perform a third-party penetration test, review PayMongo's current signing documentation against the adapter, establish data retention/privacy terms, and confirm applicable Philippine tax and data-protection obligations.

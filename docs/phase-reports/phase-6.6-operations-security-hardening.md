# Phase 6.6 — Operations & Security Hardening

## Executive summary

The existing operational controls were audited and the remaining endpoint-level rate-limit gaps were closed. No redesign was made to commerce, backup, scheduler, observability, or the frozen BKE Licensing Agent boundary.

## Changes

- Added administrator/IP rate limits to observability mutations, backup creation, backup actions, and download-grant issuance.
- Confirmed CSP nonce handling, HSTS, Referrer-Policy, Permissions-Policy, frame denial, MIME sniffing protection, and secure cookie flags.
- Confirmed encrypted/versioned provider credentials, fail-closed environment validation, MFA and recent-authentication gates, origin/CSRF checks, upload validation, private expiring downloads, Docker least privilege, transactional constraints, scheduler locks, and encrypted backup manifests.
- Confirmed products continue to consume only `AuthorizationDecision`; lease verification and binding persistence remain inside the Licensing Agent.

## Verification

- Development and certification migrations: 22 current; `ObservabilityAlert` indexes, unique fingerprint/status constraint, and foreign keys verified directly.
- Health/readiness: application, PostgreSQL, Valkey, MinIO, scheduler, backup worker, and Caddy running; readiness passed. Metrics correctly reports `CRITICAL` while the known Phase 6.4 recovery point is incomplete.
- TypeScript, ESLint, Prisma validate/generate, Vitest (155 passed, 6 credential-gated skipped), Playwright (11/11), production build, Docker build, security hygiene, and `git diff --check` passed.

## Remaining blockers

Phase 6.4 still needs a complete certification object set and isolated restore drill. PayMongo/Resend credential-gated evidence remains external. Legal/tax review, supply-chain controls, monitoring alert delivery, and VPS deployment remain later phases. Therefore the platform is not production-ready.

## Proposed commit

`feat(operations): harden runtime and operational security`

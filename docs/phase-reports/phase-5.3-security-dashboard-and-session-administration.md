# Phase 5.3 — Security dashboard and session administration

Status: implemented locally; not committed by this phase.

## Delivered

- owner-only administrator session list with current-session identification and safe client/network summaries;
- transactional, idempotent one/all-other/all-session revocation with immediate next-request enforcement;
- 14-day absolute and 60-minute idle limits with five-minute activity-write throttling;
- typed security-event outcomes, severities, provider/authentication context, catalog labels, safe metadata, filters, and review signals;
- normalized provider credential and validation events;
- deduplicated outbox notifications for new administrator sessions and session revocations;
- migration indexes supporting active-session and security-timeline queries;
- unit and PostgreSQL integration coverage for redaction, summaries, signals, isolation, idempotency, and bulk revocation.

## Security decisions

The feature is self-service. Global `ADMIN` does not grant access to another administrator's sessions. Raw session tokens, token hashes, raw user agents, full IP addresses, precise location, credentials, recovery codes, and provider payloads are neither returned nor logged. Review signals are conservative and trigger no automatic account action.

Revoked sessions are retained for incident review. The documented target is 90 days for revoked-session metadata and at least 365 days for security events, subject to approved legal/privacy policy. Automated purging is deliberately not enabled yet.

## Verification

Migration deployment, database status, smoke test, TypeScript, ESLint, focused unit tests, and focused PostgreSQL tests passed on 2026-08-02. Full Vitest, production build, Playwright, hygiene, and dependency audit results must be appended after execution; no unexecuted result may be represented as passed.

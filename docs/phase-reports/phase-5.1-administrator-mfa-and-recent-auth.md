# Phase 5.1 — Administrator MFA and recent authentication

Date: 2026-08-02. Status: implementation and local verification complete; owner review required; no commit created.

## Initial repository state and decisions

Phase 5.0 was the latest committed platform baseline and the working tree already contained unrelated, uncommitted branding/authentication/deployment documentation plus an interrupted Phase 5.1 foundation. The work was continued in place without rebuilding the application or beginning VPS deployment. Server-side authorization remains authoritative.

The implementation uses password plus RFC 6238 TOTP for administrators. Administrator magic-link login is blocked. TOTP secrets use versioned AES-256-GCM authenticated encryption; recovery codes use keyed hashes and atomic single use. QR rendering is local. A restricted pre-enrollment session cannot satisfy `requireAdmin`. Recent authentication is a server-owned timestamp valid for 15 minutes.

## Schema and migrations

`20260802090000_enterprise_admin_mfa` adds MFA challenges, encrypted administrator methods, hashed recovery codes, security events, and session MFA/recent/idle/absolute timestamps. `20260802093000_enterprise_admin_mfa_metadata` adds method verification/disable timestamps and enrollment/password security-event values. Existing session absolute expiry is backfilled from its prior expiry. Challenge attempts have a database check constraint.

Both migrations applied to PostgreSQL and `prisma migrate status` reported all ten migrations current.

## Enrollment, login, and recovery

Password login for an unenrolled administrator creates a recent, restricted session and redirects to mandatory enrollment. Enrollment creates an encrypted pending secret with ten-minute expiry and returns a locally rendered QR, issuer, account label, and manual key. Only a valid bounded-window TOTP activates it. Activation revokes existing sessions, creates an MFA-verified/recent session, and displays ten recovery codes once.

For an enrolled administrator, password success creates no application session. It creates a hashed five-minute challenge referenced by an HttpOnly, same-site challenge cookie. TOTP or an unused recovery code consumes the challenge transactionally and creates the session. Five invalid attempts exhaust a challenge. Recovery hashes are atomically marked used; browser coverage proves replay rejection.

MFA disable and recovery regeneration require recent admin authentication, are rate limited and audited, revoke sessions, and either force re-enrollment or display replacement codes once. Emergency recovery is CLI-only and requires explicit existing-account/MFA reset acknowledgements.

## Recent authentication and protected actions

Administrators reconfirm password plus TOTP/recovery code. Customers reconfirm password. A safe local return path resumes the operation. The following routes now enforce recent authentication: permanent product deletion; destructive customer deletion, suspension, reactivation and device reset; license reveal/transfer/renew/revoke/status changes; administrative device deactivation; trial grant/grace/revoke; offer create/status mutations; release/version mutations; artifact replacement/removal; audit export; MFA disable; recovery regeneration; and password change. Customer license disclosure uses the customer recent-password boundary.

Admin creation remains CLI-only. No web role-change, refund adjustment, other-admin session revocation, or API-credential endpoint exists in Phase 5.1; those future endpoints must adopt the same boundary.

## Session, throttling, events, and keys

Sessions are database-backed; cookies contain random tokens whose hashes are stored. Production uses a Secure `__Host-` HttpOnly cookie. Absolute lifetime is 14 days, idle lifetime 60 minutes, and activity is persisted at five-minute intervals. Enrollment, factor changes, password change, and bootstrap credential rotation revoke sessions.

Login, MFA challenge, enrollment start/verification, recent confirmation, recovery regeneration, MFA disable, and password change have IP/user-scoped limits backed by Valkey in the verified environment. Security events cover password acceptance, MFA success/failure/enrollment/disable/recovery, recent-auth success/failure, blocked admin magic login, and password change. IP and user-agent values are retained only as keyed hints; request bodies, credentials, factors, keys, and cookies are excluded.

`MFA_ENCRYPTION_KEY` is separate and mandatory at 48+ non-placeholder characters in staging/production. Development/test may fall back to `SESSION_SECRET`; this fallback is forbidden operationally. Automatic key rotation is deferred and remains a production risk.

## Commands and genuine results

- `git status --short`, route/schema/doc inspection commands: completed.
- `npm install qrcode` and `npm install --save-dev @types/qrcode`: dependencies present; audit clean.
- `npx prisma generate`, then `node scripts/normalize-generated.mjs`: passed.
- `docker compose ps`: PostgreSQL, Valkey, and MinIO healthy.
- `npm run db:migrate`, `npm run db:status`: passed; ten migrations current.
- `npm run db:seed`: passed; three products/editions restored idempotently.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test -- --run`: final result 72 passed, five credential-gated skips.
- `npx vitest run tests/integration/offers.test.ts`: 6 passed after seed restoration.
- `npm run test:e2e`: final result 6 passed.
- `npm run build`: passed; 59 pages generated.
- `npm audit --omit=dev --audit-level=critical`: zero vulnerabilities.
- `npm run security:hygiene`: passed for 271 tracked files.
- `git diff --check`: passed.

The first non-escalated database test attempt failed with sandbox `EPERM`, not an application failure. The escalated run reached PostgreSQL. An early migration edit duplicated metadata already present in the second migration; the first migration was restored to its original boundary and shadow validation then passed. Four offer tests initially failed with `INVALID_PURCHASE_PLAN` because manual local activity had unpublished a shared seeded plan; the idempotent seed restored it and both focused and full suites passed. The new browser test initially exposed locator/navigation races and accumulated test-rate-limit state; it was corrected to wait for real responses and use a per-test forwarded address. The final complete browser suite passed.

## Remaining risks and deferred work

Real PayMongo sandbox (four credential-gated cases) and Resend delivery (one credential-gated case) did not run and are not passed. Production secret provisioning, automatic MFA-key rotation, production infrastructure, backups/restore drill, monitoring, artifact malware scanning/code signing, independent penetration testing, and operational recovery exercises remain launch gates.

Phase 5.2 API credentials/service accounts and Phase 5.3 expanded security operations/session administration are documented only. Phase 5.4 certification is also deferred. The next action is owner review of this Phase 5.1 diff, followed by one isolated Phase 5.1 commit if approved.

# Phase 5 — Enterprise Security Roadmap

Status: Phase 5.1 implemented in the working tree; later subphases are documented only.

## Phase 5.1: administrator MFA and session hardening

Administrator password login is followed by mandatory RFC 6238 TOTP. An administrator without an enrolled method receives a restricted session that can access only `/security/mfa`; it cannot satisfy `requireAdmin`. An enrolled administrator receives no application session after password verification. A five-minute, HttpOnly, same-site challenge cookie refers to a hashed database challenge. Successful TOTP or single-use recovery-code verification consumes that challenge transactionally and creates an MFA-verified session.

TOTP secrets are encrypted with versioned AES-256-GCM ciphertext. `MFA_ENCRYPTION_KEY` is mandatory in staging and production. Development/test may fall back to `SESSION_SECRET` solely to avoid breaking isolated tooling; operators must never use that fallback in a protected environment. Recovery codes are random, displayed once, stored only as keyed hashes, and atomically marked used. TOTP accepts the current 30-second interval plus one interval either side.

Administrator sessions have a 14-day absolute lifetime, a 60-minute idle lifetime, server-owned MFA and recent-auth timestamps, and revocation after enrollment. Recent authentication requires the current password and a current TOTP code, is valid for 15 minutes, and is checked by `requireRecentAdmin`. Security events retain keyed network/user-agent hints rather than complete values and exclude credentials, TOTP secrets, codes, cookies, and raw request payloads.

High-risk action policy:

- permanent product and customer deletion: recent authentication;
- customer suspension/reactivation and device resets: recent authentication;
- customer license reveal: recent password authentication; administrative license and device mutations: recent administrator authentication;
- audit export, artifact replacement/removal, offer zero-total/account-specific mutation, MFA disable/recovery regeneration, role changes, and other-admin session revocation: must use `requireRecentAdmin` when exposed.

The bootstrap script requires an explicit production acknowledgement, refuses a second distinct administrator unless `ADMIN_ALLOW_ADDITIONAL=true`, revokes old sessions when resetting the selected administrator, and forces MFA enrollment on next login. There is no public administrator registration path. Administrator magic links are rejected; customer magic links remain available.

## Phase 5.2: API credentials, service accounts, and rotation — not implemented

Planned: scoped API keys, personal access tokens, service accounts/client credentials, identifiable non-secret prefixes, hashed one-time-reveal secrets, expiry, rotation, revocation, last-used timestamps, optional IP restrictions, permission scopes, webhook signing-secret versioning, API-specific rate limits/audit events, and future licensing-client credentials. No API credential implementation exists in Phase 5.1.

## Phase 5.3: security dashboard and session operations — not implemented

Planned: active-session administration, login history, failed attempts, MFA and API-key activity, security-event timeline, suspicious-activity rules, administrator alerts, targeted/revoke-all session operations, recovery events, and security notifications. Phase 5.1 exposes only the administrator's own summary and MFA management.

## Phase 5.4: advanced detection and response — not implemented

Planned: security event export/SIEM forwarding, anomaly rules, notification workflows, incident case correlation, key-version rotation jobs, and tested privileged-account recovery procedures.

## Current limitations and release blockers

- Browser enrollment and the existing commerce/admin regression journeys pass. Dedicated coverage also rejects recovery-code replay and verifies forced recent-auth expiry and renewal. Challenge-expiry timing remains covered at the domain boundary rather than with a five-minute browser wait.
- Manual catalog changes can invalidate shared seed fixtures; restore them with the idempotent `npm run db:seed` before certification. The final focused offer suite and full suite passed after that restoration.
- No production key rotation job exists. Ciphertext carries key version `v1`; rotating the environment key requires a controlled re-encryption operation before old key removal.
- Account takeover recovery is an operator-assisted, identity-verified process; there is intentionally no email-only MFA bypass.

## Operations

Generate `MFA_ENCRYPTION_KEY` independently with at least 48 random characters. Store it only in the deployment secret store. Back it up separately from the database. Loss makes enrolled TOTP seeds undecryptable; disclosure requires incident response, forced administrator session revocation, and re-enrollment. Never print the key, TOTP seeds, challenge cookies, recovery codes, or raw security requests.

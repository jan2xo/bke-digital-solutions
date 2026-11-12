# PREPRODUCTION Agent startup machine public-key enrollment and revocation

Tracking: [Agent issue #130](https://github.com/jan2xo/bke-licensing-agent/issues/130). Pinned DS base `9633ca81d706f3f8001391a815fdacc0597981b2`, Agent signer `dfbad7ba0fb37aa6ef520b6611425b13ba988044`.

## Single behavioral intent
An Agent's public-only enrollment candidate must never become an ACTIVE Digital Solutions signer through self-submission. A first authenticated Google OIDC **ADMIN** stages the exact key, device and public-key fingerprint; a *different* authenticated ADMIN must separately confirm the fingerprint they verified out-of-band, and submit a **fresh real signed Agent installer attestation** proving possession of that key. An audit and immutable SQL state transition commit together. Revocation by an authenticated ADMIN is terminal and stops issuance at the existing `AgentStartupAttestationSigningKey.status = 'ACTIVE'` gate.

## Production and trust locks
- **Source-only** service, no HTTP route, public endpoint, automatic installer registration, privileged seed sharing, production key provisioning or deployment.
- Env `STARTUP_MACHINE_ENROLLMENT_ENABLED` generation-independent, OFF by default and hard REFUSED in production.
- Both service entrypoints obtain principal from the current verified Google ADMIN cookie; caller cannot supply actor id to the entrypoint. No product/customer bearer can enroll an Agent key. SQL also records stage/activation/revocation admins and SHA-256 proof/fingerprint audit.
- Staging candidates have **exactly** the Agent's schema and public-only Ed25519 key. Never accept caller-controlled trust, duplicate key/device, alternate JSON or private material. A separately verified 64-char SHA-256 fingerprint MUST match independently checked out-of-band key. Human fingerprint verification is a prerequisite, **not** cryptographically proven by source code.
- Approval verifies a fresh signed installer proof with the staged public key, exact kid/device identity, and bounded issued/expiry times; this proves private-key possession, not hardware attestation or GitHub release provenance. The signed proof is not itself a credential to activate a key.
- Approval must be by a different active ADMIN from staging. SQL `FOR UPDATE` locks and conditional `status='STAGED'` updates; no duplicate ACTIVE device; revocation terminal. All writes and audit in a SERIALIZABLE transaction. Fail closed on rollback or missing logs.
- Does not alter existing issuance path or authentication of ACCOUNT/LICENSE_KEY. A license key still does not need Google login.

## Certification ownership
- Required minimum graph: `pr core identity licensing prisma-isolation` (auth binding, signing challenge, SQL transition persistence/migration, review and audit).
- Not required: `commerce payments notifications catalog platform native-account agent-store standalone` and crossrepo Agent suite, because Agent source is pinned unchanged. Reuse [Agent #133 exact-head certification](https://github.com/jan2xo/bke-licensing-agent/actions/runs/43270749423).
- Neither this approval flow nor a single emitted .NET fixture proves full installed Agent → DS → Agent policy acceptance. A separately pinned cross-repo vector test plus signed release/installation provenance remains required.
- **PRODUCTION LOCKED**: no production DB migrations/mutations, emails/payments, deployment, release/signing cutover or customer enrollment.

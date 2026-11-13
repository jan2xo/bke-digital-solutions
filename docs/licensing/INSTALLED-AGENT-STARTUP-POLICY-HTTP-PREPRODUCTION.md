# Installed Agent → Digital Solutions startup-policy HTTP transport (PREPRODUCTION)

Tracking: [Agent installed positive acceptance #130](https://github.com/jan2xo/bke-licensing-agent/issues/130), [DS implementation PR #372](https://github.com/jan2xo/bke-digital-solutions/pull/372).

## What is now implemented (source only)

The server-only policy producer already verifies Ed25519 v1 or explicit ES256 v2
installed Agent attestation against a separately, independently enrolled SQL
ACTIVE machine public key and enforces canonical published standalone
Product/ProductVersion/SQL ProductActivationPolicy. This intent adds an
**optional staging-only POST transport**, not a new credential or signing
authority.

- Route: `POST /api/agent-sessions/startup-policy`
- Request protocol header: `x-bke-startup-policy-protocol: bke.installed-startup-issuance.v1`
- Request Content-Type: `application/json`
- JSON body:
  ```json
  {"signed_install_attestation": "<canonical signed installed-Agent attestation envelope string>"}
  ```
- Success 201 with `cache-control: no-store`:
  ```json
  {
    "status": "issued",
    "signed_policy_envelope": "<exact Ed25519 DS-signed installed startup policy>",
    "kid": "<SQL ACTIVE DS account-product signer kid>",
    "activation_mode": "LICENSE_KEY",
    "expires_at": "<canonical signed policy UTC expiry>"
  }
  ```
  Activation mode may be `ACCOUNT`, `LICENSE_KEY` or explicit SQL-signed
  `EITHER`, never a credential. For key-only startup the caller does not need
  a Google account or browser session; the Agent must still independently
  validate a commercial credential before granting startup.
- Error contract: `404 NOT_FOUND` disabled/prod/nonstaging;
  `400 INVALID_INPUT` or `PROTOCOL_MISMATCH`;
  `403 INVALID_PROOF` / browser-origin deny;
  `409 INVALID_PROOF` replay; `413 PAYLOAD_TOO_LARGE`;
  `429 RATE_LIMITED`; `503 ISSUER_UNAVAILABLE`.
  Never return raw input, SQL, signing keyset or private exception detail.

## Mandatory safe environment controls

**PRODUCTION ALWAYS LOCKED.** An explicit `DEPLOYMENT_ENV=staging` is
required. The *new* generation-independent
`STANDALONE_STARTUP_POLICY_HTTP_ENABLED` flag is default OFF and must be
explicitly enabled *together with* existing default-OFF
`STANDALONE_STARTUP_POLICY_ISSUANCE_ENABLED`. Runtime also requires an
approved, separately stewarded account-product Ed25519 private keyset and
exactly one real SQL ACTIVE matching signer. Neither the DB schema, mocks,
CI test vectors nor this source code establish real signer custody.

Staging uses a distributed rate limiter. Each request is limited by IP before
any untrusted body parsing and by SHA-256 of the untrusted outer machine key
identifier after bounded JSON parsing. Those limits are abuse controls only;
the **real authorization** remains the independently enrolled signing key
and cryptographic attestation in DS SQL, not a rate-limit label. On
distributed-limiter unavailability issuance denies. Browser `Origin`,
cookies and unrelated `Authorization` bearers are rejected; the endpoint
never treats an account/customer bearer as install attestation.

The route exposes no machine-key **enrollment/activation** operation. The
separate two-different-verified-ADMIN ceremony, independent fingerprint,
genuine installed Agent attestation and actual Agent public trust must exist
*before* use. No private signer bytes are transported over this route.

## Certification ownership and known limits

The existing `prepareAndSignStandaloneStartupPolicyInTransaction` remains
the single authority for signed attestation verification, SQL mode/release
lock, unique nonce consume, active account-product signer/private-key match,
serialized signed Agent policy, audit and transaction commit. This adapter
must not duplicate or bypass those checks. Source tests cover HTTP
ineligibility, protocol, input bounds, abuse limits, replay, redaction and
response-after-commit. Disposable core PostgreSQL tests already exercise
real SQL signing with ephemeral test keys and replay denial.

**This is NOT real preproduction positive acceptance yet.** It does not
certify that a deployed DS staging environment has genuine issuer custody,
approved dual-human ADMIN registration, real installed Agent signer,
actual commercial/account credential, physical TPM, or an approved isolated
Windows x64 SYSTEM Agent+Render Dock grant. A separate pinned Agent HTTP
consumer and operator deployment/approval intent must be implemented and
certified. The human-only protected Windows acceptance workflow remains
undispatched. No production activation, database migration, publishing or
release is authorized by this feature.

## Minimum intended certification

DS `core identity licensing platform`, exact source head, because the
transport bridges HTTP security and license policy issuance. No Prisma
migration change. Agent, Render Dock, Launcher and SDK unchanged; do not
wake their heavy suites merely because this source-only route exists.

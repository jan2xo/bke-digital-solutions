# `bke.licensing.v1` cloud-to-Agent contract — FROZEN

This is the frozen wire boundary between BKE Digital Solutions and the separate BKE Licensing Agent. It does not replace the Agent's AuthorizationService, Verified License Repository, Active License Binding, License Center, or AuthorizationDecision. Wire compatibility was certified locally; production runtime handoff remains environment-gated.

## Certification signing keys

Generate a certification-only Ed25519 pair with:

```bash
npm run licensing:keys -- .certification-secrets
```

Docker env files cannot contain multiline PEM values. Base64-encode each PEM
file onto one line before placing it in `.env.certification`; the application
decodes it and exposes the public value as PEM SubjectPublicKeyInfo through
`/api/licensing/keys`. Keep the private file outside Git.

## Ownership

BKE Digital Solutions is the commercial authority. It validates account, license, subscription, revocation, expiration, and commercial device eligibility, then issues signed entitlement material.

The BKE Licensing Agent is the runtime authority. It verifies the lease signature, stores the verified lease locally, manages active bindings, and returns AuthorizationDecision to installed products. Products never call the commerce activation endpoint as a runtime authorization replacement.

## Activation

`POST /api/licenses/activate` accepts the commercial license key, agent device identifier, and optional operating-system, architecture, and label fields. The cloud may record DeviceActivation for limits, transfer, revocation, and administration. That record is commercial history, not the Agent's local active binding.

The response contains only a signed `bke.lease.v1` envelope and issuance metadata:

The current envelope is exactly the Agent envelope (no translation layer):

```json
{"payload":"<canonical UTF-8 JSON string>","signature":"<standard Base64>","key_id":"production-ed25519-v1","algorithm":"Ed25519"}
```

The payload is the strict Agent `LicenseLease` schema: `lease_id`, `generation`,
`server_revision`, `product_id`, `installation_id`, `device_id`, `version`,
`issuer`, `issued_at`, `not_before`, `expires_at`, `key_id`, `algorithm`,
`revoked`, and `superseded_by`. JSON is UTF-8, sorted by key, compact, and the
exact serialized string is signed and returned unchanged. Public keys are PEM
SubjectPublicKeyInfo. Perpetual commercial licenses receive finite 30-day
renewable runtime leases so revocation remains effective.

There is intentionally no `authorization.allowed`, AuthorizationDecision, launch permission, or runtime authorization boolean. The Agent verifies the envelope and produces the product-facing decision.

## Key lookup and lifecycle

`GET /api/licensing/keys` returns versioned Ed25519 public-key metadata. Private signing keys are never returned or committed.

Refresh and renewal issue replacement leases after commercial checks. Suspension, revocation, expiration, and over-limit records cannot receive a valid new lease; the Agent separately invalidates its local binding according to its own policy. Breaking wire changes require a new schema version and Agent compatibility certification.

## Commercial renewal integration

Renewal leases are issued only from the confirmed `payment.paid` renewal path. A
renewal order references the subscription being renewed; settlement extends the
period once and creates an idempotent `CommercialLeaseOperation` containing the
order/payment evidence, prior expiry, new expiry, and purchased duration. Early
renewals add duration to the current future expiry; expired entitlements start
from the renewal effective time. The operation and lease history are protected
by unique identifiers and serializable transactions. This commercial workflow
does not perform Agent persistence, binding, or runtime authorization.
# RM7 lifecycle correction

Lease records are durable and monotonic. Each issuance for an installation/device
increments both `generation` and `server_revision`; the previous record is marked
`SUPERSEDED` and linked to the replacement. A lease is never issued with a
placeholder version: an active semantic product version is required.

Supply-chain verification uses a separate trusted keyring
(`SUPPLY_CHAIN_TRUSTED_KEYS`) from the commercial lease signer. Historical
evidence records the exact key ID; retired keys may remain trusted for
verification without becoming the active signer.

## Commercial lease lifecycle

Digital Solutions exposes commercial issuance actions through the lease endpoint:
`ACTIVATION`, `REFRESH`, `RENEWAL`, `TRANSFER`, `REPLACEMENT`,
`REVOCATION_REPLACEMENT`, and `KEY_ROTATION`. Each action validates the active
commercial entitlement and releasable product version, increments generation and
server revision, records an immutable action, and supersedes the prior commercial
record. Runtime verification, persistence, active binding, and
`AuthorizationDecision` remain Licensing Agent responsibilities.

## Commercial signing registry (RM8)

Commercial lease signing keys use the dedicated `CommercialSigningKey` registry,
separate from supply-chain signing. PostgreSQL stores public key material and an
`env:` private-key reference only; the secret provider resolves private material
outside the database. One ACTIVE key is enforced by a partial unique index and
RETIRED public keys remain available for historical verification. Bootstrap uses
the existing environment configuration. Lease issuance now resolves exactly one
ACTIVE registry key and its external private-key reference; legacy environment
variables are bootstrap-only after a registry row exists. Invalid references fail
closed and retired public keys remain available for historical verification.

RM8C adds an administrator-only rotation workflow. Successor references are
validated against their Ed25519 public keys before a serializable transaction
retires the prior key and activates the successor. Rotation operations are
unique and replay-safe; private references and key material are never returned.

Lifecycle integration note: refresh reuses an active, unexpired authoritative
lease without advancing generation; material-change refreshes issue successors.
Revocation records a terminal refusal operation and never emits an active
revoked successor. Renewal and transfer still require runtime certification of
their complete successor-issuance transaction boundaries.

## Commercial transfer integration

Administrator-approved transfers require the exact purchased order-item policy to
be transferable; unrelated product policies cannot authorize a transfer. The
operation records source/target accounts, target installation/device identifiers,
policy, actor, and a stable operation ID. Existing commercial activations are
released as history. Verification, persistence, active binding, and runtime
authorization remain Agent responsibilities.

## Commercial refresh integration

Refresh requests are checked against the commercial license lease history and
must match the same installation/device tuple and current lease ID. The server
creates a durable `REFRESH` operation and delegates successor signing to the
shared issuance service; repeated operation IDs reuse the existing result.
Suspended, revoked, expired, mismatched, or unreleasable entitlements fail
closed. Runtime validity and binding remain Agent responsibilities.

## Commercial revocation integration

Revocation is refusal-based: once Digital Solutions marks a license revoked or
suspended, ordinary activation, refresh, transfer, and replacement issuance
fails closed. The administrator revocation workflow records a durable,
idempotent `REVOCATION_REPLACEMENT` operation with actor, reason, and timestamp,
preserves predecessor lease history, and deactivates commercial devices. The
current protocol does not authorize a normal active revoked successor lease.

RM7H transfer operations use the persisted source predecessor and prepare → issue/reuse → finalize, so ownership is
not completed before a durable successor lease exists. Renewal operations record
prepared successor work or the terminal no-active-installation result.

For bound renewals, the confirmed-payment webhook collects only existing
commercial activation plus lease-history bindings, then invokes shared lease
issuance after the entitlement transaction. Signing failures leave payment and
entitlement settled while the prepared operation remains retryable; the scheduler
retries these operations without extending entitlement again. Refresh compares
version, expiry, binding, signer, status, and lifecycle revision before reuse.
Rotation replay inputs and mandatory audit evidence are transactionally bound.

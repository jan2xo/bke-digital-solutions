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
# RM7 lifecycle correction

Lease records are durable and monotonic. Each issuance for an installation/device
increments both `generation` and `server_revision`; the previous record is marked
`SUPERSEDED` and linked to the replacement. A lease is never issued with a
placeholder version: an active semantic product version is required.

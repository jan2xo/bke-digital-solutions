# Provider credential management

Phase 5.2C stores PayMongo and Resend credentials as encrypted, versioned records. The browser and status API receive only credential type, creation time, and a small masked hint. Plaintext is never persisted in configuration metadata, returned by an API, placed in audit metadata, or logged.

## Data model

`ExternalProviderConfiguration` identifies a provider and TEST/LIVE context, enablement, sender identity, and validation state. `ExternalProviderCredential` stores an AES-256-GCM envelope, encryption key version, masked hint, activation/revocation times, replacement link, and creator. A PostgreSQL partial unique index permits one unrevoked credential per configuration and credential type.

## Runtime policy

`PROVIDER_CONFIG_SOURCE=environment` keeps the Phase 5.2 environment path. `database` resolves enabled database records through the central provider service. Fallback is denied unless `PROVIDER_CONFIG_ALLOW_ENV_FALLBACK=true`; enabling fallback requires the corresponding environment credentials at startup. Provider adapters no longer select credentials themselves.

PayMongo mode is derived from `PAYMONGO_LIVEMODE` and deployment policy. Local production simulation accepts TEST only. PayMongo LIVE configuration cannot be saved, validated, or enabled outside a real production deployment. Resend uses its production verified sender domain but remains separately configurable.

## Administrative controls

`/admin/providers` requires an administrator with enrolled MFA. Every mutation additionally requires a recent authenticated session, a trusted Origin, Zod-valid input, and the administrative provider rate limit. Save, validate, enable/disable, replace, and revoke operations are audited without secret values. Validation must pass before enablement.

Saving a blank secret field preserves the current value. Saving a replacement first revokes the prior row, writes fresh randomized ciphertext, links the prior row to its replacement, and commits atomically. Revocation disables the configuration. No plaintext reveal feature exists.

## Limitations

The database source requires an externally supplied master key. It is not a substitute for a managed secret vault or HSM. Provider validation checks authentication and configuration compatibility; it does not certify the complete payment or email lifecycle. Existing environment credentials are never copied automatically. Rotate them before database activation.

Runtime resolution deliberately has no credential cache in Phase 5.2C. Configuration changes therefore take effect on the next provider operation without cache invalidation or a rebuild; the tradeoff is one database read per provider operation when database source is selected.

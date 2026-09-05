# V2 Platform Provider Configuration

`v2/platform/providers` owns the host/platform mechanics for external-provider configuration and credential lifecycle.

## Boundary

Platform owns **HOW** provider credentials and runtime configuration are selected, encrypted, decrypted, validated, enabled, revoked, and safely surfaced to provider adapters. Payment, email, and other domains own **WHY** a provider is invoked.

This seam intentionally does not import or own:

- V1 `lib/provider-config/*`, `lib/db.ts`, or global Prisma
- `@bke/*` domain packages or `v2/modules/*`
- payment settlement or webhook business semantics
- email content/rendering semantics
- HTTP/admin routes
- security-event persistence, audit persistence, or email side effects

Persistence enters through `ProviderConfigurationStore`. Remote provider validation enters through `ProviderValidationClient`. Safe operational effects leave through `ProviderOperationalEventSink`, allowing host composition to route them to Audit/Security/Email without exposing raw credentials.

## Preserved V1 mechanics

- providers: PayMongo and Resend
- contexts: TEST and LIVE
- credential kinds: secret key, webhook secret, API key
- database/environment source selection with explicit fallback policy
- AES-256-GCM encrypted credentials using version-bound AAD
- current + previous key-version resolution
- masked credential hints only
- fail-closed missing/disabled configuration
- PayMongo test/live key-prefix enforcement
- PayMongo live mode forbidden outside real production or during local production simulation
- PayMongo webhook-secret shape validation
- Resend API-key and sender-domain validation
- credential replacement/reset-to-not-validated mechanics delegated atomically to the durable store
- enablement requires VALID status and all required active credentials
- revoke disables through the durable-store operation
- validation stores only safe result codes

## Adoption

This attack establishes and certifies the provider-configuration platform seam only. Implementing the real Prisma store, real PayMongo/Resend validation clients, admin route wiring, security/audit/email effect routing, and replacement of V1 provider-config imports belong to host adoption/composition.

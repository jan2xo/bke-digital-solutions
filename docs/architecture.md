# Architecture

## Local production simulation

Before VPS deployment, the production runner is exercised as `Cloudflare HTTPS -> named tunnel -> loopback HTTP Caddy -> Next.js -> PostgreSQL/Valkey/MinIO`. Only Caddy binds `127.0.0.1:8080`; data services remain private. `APP_URL` is the public browser/email/provider-redirect origin, `INTERNAL_APP_URL` is the private container origin, and `PUBLIC_WEBHOOK_ORIGIN` is the public webhook origin. Certification Caddy handles the tunnel's local host override and passes the original forwarded public host upstream; production Caddy keeps ACME/TLS behavior.

## Platform administration relationships

```text
Administrator session
        |
        v
  /admin server pages ---- read ----> Prisma/PostgreSQL
        |
        v
small client action controls
        |
        v
 /api/admin routes
   | requireAdmin + Origin + Zod
   | transactions + state rules
   +----> Product / Version / Artifact ----> private S3
   +----> Customer / Session / Account
   +----> License / Device / Download
   +----> Order / Invoice / EmailOutbox ----> Resend provider
   +----> AuditLog <---- every mutation
```

```text
Product 1---* Edition 1---* PurchasePlan
   |             |              |
   |             * License      * PERPETUAL / MONTHLY / ANNUAL
   |             * Subscription   (annual total is derived)
   * ProductVersion 1---* ProductArtifact 1---* DownloadGrant
   * legacy Price / LicensePolicy (historical compatibility)

User 1---* CustomerAccount 1---* Order 1---1 Invoice
                         |          |
                         * License  * Payment
```

## Phase 6.1 retention and cleanup boundaries

`User` and `CustomerAccount` have explicit lifecycle, retention-expiry, pseudonymization, and legal-hold state. Closure revokes sessions and suspends entitlements; it does not cascade into historical commerce. Legal acceptances remain `RESTRICT`-protected and immutable. Audit/security evidence uses nullable actor/account references so an otherwise eligible final purge does not destroy the event.

Private-object deletion is staged: a transaction marks the product/artifact and creates idempotent `StorageCleanupJob` rows; workers delete objects only after commit; success/failure is recorded; product rows are finalized only in a later serializable transaction after dependencies are rechecked. Stored object keys never enter ordinary audit metadata.

Account authorization is capability-based rather than a numeric role rank. `BILLING` sees finance and checkout operations, `LICENSE_MANAGER` manages entitlements, and `MEMBER` receives no broad account-level commerce visibility; individually assigned entitlements remain narrowly accessible.

The administration layer is not a separate service. It is an RBAC-protected presentation and command layer over the same domain models used by customer and webhook flows. This preserves one source of truth and prevents admin-only shadow state.

## Legal document and consent boundary

`LegalDocument` is the stable identity and public slug for one semantic document type. `LegalDocumentVersion` is an append-only version stream: drafts may change or be deleted, while PostgreSQL triggers prevent content mutation or physical deletion after publication. One document type and one current published pointer are unique. Publishing archives the previous current version in a serializable transaction; restoring a prior version changes state and the current pointer without rewriting its content.

`LegalAcceptance` records the user, optional purchasing account, exact document version, context, time, request metadata, rendered-content hash, and variable snapshot. Foreign-key restrictions and database triggers reject updates and deletes. Registration records Terms and Privacy in the registration transaction. Checkout records EULA and Refund acceptance, plus Subscription Terms for monthly and annual plans, in the order transaction. A published version marked for reacceptance redirects customers who predate that publication on their next interactive login or protected portal visit to `/legal/accept` without revoking the active session. Customer commerce, download, license, order, device, and trial APIs also return `LEGAL_REACCEPTANCE_REQUIRED` until completion, preventing direct API bypass.

Legal Markdown is rendered by a deliberately limited server-side renderer. Raw HTML is escaped, unsafe links are neutralized, and only approved variables are substituted. The public route renders the source with current environment values; acceptance evidence hashes that exact rendered output and snapshots those values.

The application uses server-rendered Next.js pages and route handlers. Browser input is treated as untrusted; prices, ownership, payment state, and entitlement rules are always loaded from PostgreSQL. Prisma supplies parameterized queries and transactions.

The domain is provider-neutral: `PaymentProvider` maps hosted checkout and signed events into normalized payment events. PayMongo and deterministic mock adapters implement that boundary. Resend and S3-compatible services are likewise behind server-only modules.

Customer accounts are the ownership boundary. An individual has an owned individual account; organizations add memberships with explicit roles. Global administrator status never derives from organization membership.

Payment confirmation, invoice finalization, and entitlement issuance happen in one serializable transaction. Unique provider event, provider payment, and order-item license constraints make replay safe. License secrets are HMAC-hashed for activation lookup and separately encrypted for repeatable, authorized portal display. Every display is ownership/RBAC checked and audited; plaintext is never stored or logged.

Recurring terms are tracked internally. A reminder prompts the customer to authorize a fresh checkout; the platform does not claim unattended recurring charges.

## Editions and commercial terms

Edition is the entitlement boundary: features, authorized-user count, devices per user, and update policy are copied into immutable order-item snapshots. PurchasePlan is the commercial boundary. Perpetual and monthly plans store integer minor-unit amounts; annual plans store only a monthly-plan reference and a 0–1000 basis-point discount. Checkout accepts only `purchasePlanId`, reloads all terms, and calculates annual totals with integer half-up rounding. New licenses and subscriptions retain edition/plan links while old scalar Price/LicensePolicy snapshots remain readable.

## Product trials and grace periods

`TrialGrant` links an account, product, edition, and normal license. A self-service grant is unique by account, product, and UTC calendar year, so each account can start one seven-day trial for a specific product each year. Administrator grants do not consume that allowance and may add 0–14 grace days. Grant, grace change, revocation, license state, zero-value order snapshot, and audit records are written transactionally. Trial downloads and activations use the same ownership, device-limit, expiration, and private-storage boundaries as paid licenses.

## Pending checkout recovery

`PaymentAttempt.checkoutUrl` retains the provider-hosted URL server-side. Only an owner or organization billing role can continue or cancel a pending order. A usable pending attempt is reused; an older order without a stored URL receives a separately recorded replacement attempt and later requests reuse it. Replacement reservation locks the order row, rejects a second recent creation with a controlled conflict, and recovers a creation left stale for five minutes. Cancellation marks creating/pending attempts cancelled but cannot erase a provider-side capture. A later verified paid webhook is authoritative, moves the locally cancelled order to paid, and runs the existing idempotent invoice/entitlement transaction exactly once.

Cancellation and replacement finalization lock the order so they serialize with provider settlement. Successful settlement marks its attempt completed. A failed stored webhook may retry only with the identical payload hash; reusing an event ID with changed bytes is rejected.

## Archived product deletion boundary

`evaluateProductDeletionEligibility` is the single server-side policy boundary for permanent product deletion. It explicitly joins immutable order-item snapshot identifiers back to orders, invoices, payments, and attempts; it also counts customer carts, subscriptions, licenses and their assignments/activations/events, download grants, and artifact download counters. Audit targets are scalar identifiers and remain after deletion.

Only an archived product with zero blockers is eligible. The guarded operation locks and re-evaluates the product in a serializable transaction, deletes exclusive private artifact/image objects, removes artifacts before versions and prices before policies, deletes the product, and writes the success audit in that transaction. Storage cleanup failures are redacted, prevent a 204 response, and roll back database changes. S3 deletion is idempotent, so any objects removed before a later object fails can be safely retried; eligibility guarantees no customer owns or has downloaded those disposable objects.

## Customer erasure boundary

Permanent customer deletion is a separate, explicit owner-approved policy and does not weaken archived-product deletion. It is available only on a non-administrator customer detail page. The DELETE route requires a session authenticated within 15 minutes, global ADMIN role, same-origin request, a distributed rate limit, exact customer-email confirmation, and the fixed phrase `DELETE ALL CUSTOMER DATA`.

The serializable transaction locks the user and removes owned accounts plus their orders, payment attempts, payments, invoices, subscriptions, licenses, activations, downloads, trials, memberships, authentication records, and queued email. It refuses self-deletion and all administrator targets. Associated audit entries are erased to avoid retaining customer data; one new tombstone retains only the deleted user ID and aggregate counts. This operation deliberately destroys commercial history and must remain operationally disabled until retention and erasure policy is approved.
# Discount and negotiated-offer architecture

`DiscountOffer` is the mutable administrative definition; `OfferRedemption`, `OrderItem.pricingSnapshot`, and subscription offer fields are transaction history. Checkout evaluates catalog pricing first (including the independently constrained annual catalog calculation), then applies at most one eligible offer. A serializable transaction and row lock protect redemption limits. Customer-account eligibility is evaluated inside the billing-account authorization boundary. See `discount-offers.md` for lifecycle and deployment details.
# Phase 5.1 security boundary

Administrator authentication is password followed by a six-digit code delivered to the administrator's verified email through the configured email provider. Password-only login creates a purpose-bound database challenge, not an application session. The code is deterministically derived from a random HttpOnly challenge token with a keyed HMAC and is never stored in plaintext; PostgreSQL stores only the challenge-token hash. Login, enrollment, and recent-authentication challenges are isolated, expire after ten minutes, allow five attempts, and are single-use. Resending invalidates the prior challenge. Unenrolled administrators receive a restricted enrollment session that cannot pass `requireAdmin`. Recovery codes remain keyed-hash, atomic, single-use fallbacks. Customer password and magic-link authentication is unchanged.
# Phase 5.2C provider boundary

PayMongo and Resend adapters resolve typed configuration through `lib/provider-config/service.ts`. Source selection is explicit (`environment` or encrypted `database`), fallback defaults off, and live PayMongo is denied during local simulation. Database credentials use versioned AES-256-GCM envelopes and one-active-credential constraints. See [provider credential management](security/provider-credential-management.md).

# Phase 5.3 administrator security boundary

`Session` remains the server-owned authorization record. A cookie carries only a random token; PostgreSQL stores its hash. Revocation sets `revokedAt` and a bounded reason, and `currentSession` rejects it on the next request. The dashboard queries only the current administrator's active sessions and renders normalized browser/device and keyed network hints. Session commands require same-origin POST, recent password-plus-MFA authentication, ownership checks, rate limiting, and a database transaction that records the normalized security event and deduplicated outbox notification.

`SecurityEvent` is a typed operational timeline with outcome, severity, optional provider/authentication/session context, keyed request hints, and allowlisted metadata. Review signals are deterministic advisory summaries; they do not claim compromise or automatically suspend accounts. Provider credentials and raw provider payloads remain outside this event store.
# Phase 6.0 runtime boundary

Development, certification, and production share one validated application configuration, generated Prisma client, append-only migration set, standalone application image, and migration-first startup order. Certification is a production Compose overlay with loopback-only test access; it does not contain an alternate application architecture. The readiness endpoint covers PostgreSQL, Valkey, private object storage, and selected-provider configuration. External provider network availability is monitored and certified separately so a provider outage does not make every application instance restart. See `runtime-parity.md` and `certification-runtime.md`.

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

The administration layer is not a separate service. It is an RBAC-protected presentation and command layer over the same domain models used by customer and webhook flows. This preserves one source of truth and prevents admin-only shadow state.

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

Administrator authentication is password then TOTP. Password-only login for an enrolled administrator creates a database challenge, not an application session. Unenrolled administrators receive a restricted enrollment session that cannot pass `requireAdmin`. Session privilege, MFA verification, recent authentication, idle expiry, and absolute expiry are server-owned database state. See [Phase 5 enterprise security](./phase-5-enterprise-security.md).

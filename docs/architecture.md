# Architecture

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
Product 1---* ProductVersion 1---* ProductArtifact
   |                 |                    |
   * Price           |                    * DownloadGrant
   * LicensePolicy   |                    * downloadCount
   * License --------+---* DeviceActivation
   * Subscription

User 1---* CustomerAccount 1---* Order 1---1 Invoice
                         |          |
                         * License  * Payment
```

The administration layer is not a separate service. It is an RBAC-protected presentation and command layer over the same domain models used by customer and webhook flows. This preserves one source of truth and prevents admin-only shadow state.

The application uses server-rendered Next.js pages and route handlers. Browser input is treated as untrusted; prices, ownership, payment state, and entitlement rules are always loaded from PostgreSQL. Prisma supplies parameterized queries and transactions.

The domain is provider-neutral: `PaymentProvider` maps hosted checkout and signed events into normalized payment events. PayMongo and deterministic mock adapters implement that boundary. Resend and S3-compatible services are likewise behind server-only modules.

Customer accounts are the ownership boundary. An individual has an owned individual account; organizations add memberships with explicit roles. Global administrator status never derives from organization membership.

Payment confirmation, invoice finalization, and entitlement issuance happen in one serializable transaction. Unique provider event, provider payment, and order-item license constraints make replay safe. License secrets are HMAC-hashed and never recoverable from the database.

Recurring terms are tracked internally. A reminder prompts the customer to authorize a fresh checkout; the platform does not claim unattended recurring charges.

## Archived product deletion boundary

`evaluateProductDeletionEligibility` is the single server-side policy boundary for permanent product deletion. It explicitly joins immutable order-item snapshot identifiers back to orders, invoices, payments, and attempts; it also counts customer carts, subscriptions, licenses and their assignments/activations/events, download grants, and artifact download counters. Audit targets are scalar identifiers and remain after deletion.

Only an archived product with zero blockers is eligible. The guarded operation locks and re-evaluates the product in a serializable transaction, deletes exclusive private artifact/image objects, removes artifacts before versions and prices before policies, deletes the product, and writes the success audit in that transaction. Storage cleanup failures are redacted, prevent a 204 response, and roll back database changes. S3 deletion is idempotent, so any objects removed before a later object fails can be safely retried; eligibility guarantees no customer owns or has downloaded those disposable objects.

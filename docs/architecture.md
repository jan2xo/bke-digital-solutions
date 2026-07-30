# Architecture

The application uses server-rendered Next.js pages and route handlers. Browser input is treated as untrusted; prices, ownership, payment state, and entitlement rules are always loaded from PostgreSQL. Prisma supplies parameterized queries and transactions.

The domain is provider-neutral: `PaymentProvider` maps hosted checkout and signed events into normalized payment events. PayMongo and deterministic mock adapters implement that boundary. Resend and S3-compatible services are likewise behind server-only modules.

Customer accounts are the ownership boundary. An individual has an owned individual account; organizations add memberships with explicit roles. Global administrator status never derives from organization membership.

Payment confirmation, invoice finalization, and entitlement issuance happen in one serializable transaction. Unique provider event, provider payment, and order-item license constraints make replay safe. License secrets are HMAC-hashed and never recoverable from the database.

Recurring terms are tracked internally. A reminder prompts the customer to authorize a fresh checkout; the platform does not claim unattended recurring charges.

# Commerce — V2 Ownership Boundary

Commerce owns the commercial transaction lifecycle. This module is being rebuilt capability-by-capability from V1 evidence rather than copying the V1 checkout service.

## What I need

`bke.commerce.purchase-plan-pricing.v1` needs only an immutable purchase-plan snapshot.

`bke.commerce.purchase-plan-lookup.v1` needs only Commerce-owned persistence. `editionId`, legacy `productId`, and legacy `licensePolicyId` are stored as opaque external identifiers; Commerce does not require or foreign-key Entitlements, Catalog/Product, or Licensing tables.

Later Commerce capabilities may consume approved contracts for:

- Accounts authorization and account lifecycle state;
- Catalog/Product identity;
- Entitlements Edition identity/definition;
- Legal acceptance prerequisites;
- payment-provider operations;
- notification/email transport;
- audit/event transport.

Those dependencies must be capability contracts, never another module's Prisma client or tables.

## What I own / what I do

Forensic ownership from the V1 production reconciliation assigns Commerce:

- `PurchasePlan` pricing terms and persistence;
- legacy `Price` compatibility during transition;
- `Cart` / `CartItem`;
- `Order` / `OrderItem` and immutable commercial snapshots;
- `Invoice` / `InvoiceLine`;
- `DiscountOffer` / `OfferRedemption`;
- `Subscription` recurring commercial state;
- `Payment`, `PaymentAttempt`, `PaymentReconciliation`, `RefundOperation`, and `WebhookEvent` payment lifecycle/provider-event interpretation.

The first capability owns deterministic purchase-plan pricing: PERPETUAL, MONTHLY, and ANNUAL resolution, annual discount bounds, annual derivation from the active monthly source, safe-integer money checks, and V1 half-up rounding.

The second capability owns PurchasePlan lookup and its legacy Price compatibility seam while deliberately keeping cross-domain IDs opaque.

## What I give

Current public capabilities:

- `bke.commerce.purchase-plan-pricing.v1`
- `bke.commerce.purchase-plan-lookup.v1`

They return typed pricing/persistence results. They do not expose database clients, provider credentials, V1 helpers, or another module's persistence.

## Explicit non-ownership

Commerce does **not** own:

- `Product` — Catalog/Product owns canonical product identity;
- `Edition` — Entitlements owns entitlement-definition identity;
- `LicensePolicy` / device authorization — Licensing owns those semantics;
- `CustomerAccount`, membership, or account lifecycle — Accounts owns them;
- authentication/session state — Identity owns it;
- legal acceptance policy/persistence — Legal owns it;
- entitlement issuance — Entitlements owns it;
- HTTP/same-origin/rate limiting/cookies — host/presentation/security boundary;
- email delivery or global audit persistence — host/provider capabilities;
- release artifacts, updates, distribution, or certification.

`OrderItem.entitlementSnapshot` is historical commercial evidence; its existence does not make Commerce the owner of Entitlements behavior.

## Capability attack order

1. Purchase Plan Pricing — CERTIFIED.
2. PurchasePlan persistence + legacy Price compatibility — ACTIVE.
3. Offers / redemptions.
4. Order + invoice creation and immutable pricing snapshots.
5. Checkout orchestration through Accounts / Legal / Entitlements / Payments contracts.
6. Payment attempts, provider events, reconciliation and refunds.
7. Subscription / renewal lifecycle.
8. Cart only when a real V2 consumer requires the capability.
9. Extraction hardening, standalone library adoption, and staging retirement after the owned seams are certified.

## Stop conditions

- no production PostgreSQL mutation;
- no changes to V1 behavior;
- no Product, Edition, or LicensePolicy ownership copied into Commerce;
- no direct Accounts/Identity/Entitlements/Licensing Prisma reach-through;
- no payment-provider implementation bundled into pricing/persistence;
- no frontend work in the backend capability attack;
- no Commerce extraction until public contracts and owned persistence seams are independently certified.

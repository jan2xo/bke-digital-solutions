# Discounts and customer-specific offers

## Purpose

The offer layer adds general promotions, customer-account offers, and administrative adjustments without changing the catalog pricing rules. Annual catalog prices are still calculated from the active monthly plan with a 0–10% annual discount. An optional offer is applied only after that calculation and may discount the resulting catalog amount by 0–100%.

## Authoritative pricing order

1. Load the active purchase plan, edition, product, and billing account from PostgreSQL.
2. Resolve the catalog amount. For annual plans this is `monthly × 12`, less the configured 0–10% annual catalog discount.
3. Resolve at most one explicitly supplied offer code or identifier.
4. Recheck status, dates, scope, account ownership, and redemption limits while locking the offer row.
5. Calculate the offer discount with integer minor units and basis points, using half-up rounding.
6. Snapshot catalog inputs, annual pricing, offer identity and scope, discount, duration, final total, currency, and `OFFER_V1` into the order item.

Commercial invoice lines preserve the same calculation visibly: the undiscounted annual gross amount, a negative annual catalog-discount line, a separate negative promotional-discount line including its name/code, and the final payable total. The invoice line sum must equal the payment total.

The browser submits only `purchasePlanId`, `customerAccountId`, and an optional `offerIdentifier`. It never submits an authoritative amount, percentage, or duration.

## Data model and lifecycle

- `DiscountOffer` stores the offer definition, scope, validity, limits, duration, creator, and lifecycle status.
- `OfferRedemption` reserves a single offer against one order. Its unique `orderId` prevents stacking.
- `OrderItem.pricingSnapshot` and related scalar columns are immutable transaction snapshots.
- `Subscription` stores the normal recurring amount, discounted recurring amount, discount snapshot, total discounted cycles, and consumed cycles.
- `Order.renewalSubscriptionId` connects a customer-authorized renewal order to the existing subscription.

Redemption states are `RESERVED`, `APPLIED`, `RELEASED`, and `REFUNDED`. Reserved, applied, and refunded records consume configured limits. A refund does not restore promotional eligibility. A pending reservation is intentionally retained because a delayed verified payment can still be honored; operational reconciliation is required before any future release policy is introduced.

## Plan behavior

- Perpetual: the offer changes only the one-time payable amount. It never changes capabilities, device limits, permanence, updates, or support.
- Monthly: an offer may specify 1–12 discounted cycles. A timed offer scoped generally, by product, or by edition is eligible only for monthly plans; a specifically scoped perpetual or annual plan cannot use a cycle duration. Renewal reuses the snapshot until the count is consumed, then returns to the snapshotted normal amount.
- Annual: the 0–10% catalog discount and 0–100% offer remain separate snapshot components.
- Zero totals: require a 100% offer, `allowZeroTotal`, and recent administrator authentication when created. A general promotion cannot create free perpetual access. An authorized zero-total order is finalized internally and still issues an invoice, payment record, entitlement, audit record, and transactional email records.

Grace periods are not discounts. Existing trial/license grace controls remain independent.

## Administration

Administrators manage offers at `/admin/offers`. They can create scoped offers, set dates and limits, enable/disable them, inspect reserved/applied usage, and revoke an offer only before any non-released redemption exists. All mutations require an administrator session, same-origin validation, server validation, and audit records. Full-discount authorization also requires a recent administrator login.

Customer-account offers and administrative adjustments require a `customerAccountId`. Checkout deliberately returns `OFFER_NOT_FOUND` for an offer that is missing or ineligible so another account cannot enumerate private offers.

## Database and deployment

Migration `20260731025700_flexible_discount_offers` is additive. It adds offer/redemption tables, renewal linkage, immutable pricing fields, recurring-discount fields, indexes, restrictive foreign keys, and PostgreSQL check constraints. Deploy with `npm run db:deploy` before starting application instances that contain this code. Do not edit an applied migration; follow-up corrections require a new migration.

## Verification

`tests/pricing.test.ts` covers integer arithmetic and separation from annual pricing. `tests/integration/offers.test.ts` covers immutable snapshots, customer isolation, global/per-account limits, concurrent reservation, idempotent payment application, explicitly authorized zero totals, and finite monthly renewal cycles. The full regression suite protects payment, webhook, deletion, trials, licensing, and authorization behavior.

## Known operational risk

Abandoned or failed hosted checkouts retain their offer reservation to prevent a later verified payment from oversubscribing a limited offer. A future provider-aware expiry job may release a reservation only after reconciliation proves the checkout can no longer settle.

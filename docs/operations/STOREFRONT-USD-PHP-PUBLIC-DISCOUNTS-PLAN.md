# Digital Solutions storefront — USD display, PHP settlement, public discounts

**Planning checkpoint (2026-11-12, Asia/Manila):** [Issue #355](https://github.com/jan2xo/bke-digital-solutions/issues/355). This file starts a **draft PR ledger before application coding**. No implementation, payment/production/configuration change, or merge is implied.

## Product decision

- **Main displayed currency:** USD, clearly approximate (`≈`) when converted from the canonical PHP amount.
- **Below:** actual current PHP plan price (and period); hosted PayMongo continues to charge **PHP**.
- **An eligible public discount exists:** show **original estimated USD crossed out** (not underlined), **discounted estimated USD BIG**, and **actual discounted PHP** smaller. Show discount percentage only when sourced from canonical eligible public promotion.
- **No public discount:** show **undiscounted estimated USD BIG**, standard PHP smaller, **no strike-through**.
- Label `/month`, `/6 months`, `/year` or `one-time` honestly. A simple global "lowest amount" comparison between recurring and lifetime plans is misleading.
- Responsive presentation preserves the established dark/yellow BKE visual language and clear accessibility labeling.

## Reconciled source at opening

Bootstrap base `083ef5b46765384e8a442c5700a0cfe746d0dc4f` (not a permanent head pin). Re-read live main and the current PR head before implementation; the other engineering instance may advance main.

- `app/page.tsx`: featured cards pick smallest `CommercePurchasePlanPricingCapability.resolve(...).pricing.amountMinor`, then format `From ₱...`. They do **not** preview public promotions.
- `app/products/page.tsx`: full catalog makes the same pre-promotion selection and PHP-only formatting.
- `app/landing-experience.tsx`: accepts a single `priceLabel` instead of a structured original/final/money/period display model.
- `app/products/[slug]/page.tsx`: **already** calls `COMMERCE_PUBLIC_PROMOTION_PREVIEW_CAPABILITY_ID.preview(...)`, and uses the returned `finalMinor` and `discountBps`; `components/purchase-plan-selector.tsx` already strikes through original amounts.
- [Pricing policy #321](https://github.com/jan2xo/bke-digital-solutions/issues/321) governs monthly-derived semiannual/annual plan pricing; its rules must not be recomputed independently in the storefront.

## Scope when implementation is authorized

1. Build one thin **public display quote** resolver over canonical plan pricing + canonical public-promotion preview. Quote identifies the exact product, edition, plan, interval and original/final **PHP minor-unit** amounts.
2. Include only public/eligible promotions; never expose account-scoped, coupon-only, expired, revoked or exhausted discounts as universal prices.
3. Select a representative "From" plan with an explicit, explainable term. Preserve the selected plan's identity so both old and final prices refer to **the same plan**.
4. Add a **display-only FX quote** with a trustworthy source, transparent timestamp, deterministic rounding, bounded freshness and safe unavailable/stale fallback. Do **not** invent a hard-coded permanent conversion rate or make currency conversion part of checkout authority.
5. Render consistent original/current USD/PHP pricing on homepage cards, full catalog and relevant detail presentation. Verify layout with and without promotions and for long values on mobile.
6. Revalidate canonical **PHP** pricing and promotions at checkout. PayMongo's charge, signed webhook settlement, invoices, refunds and entitlement authorization must never derive their authority from estimated USD or client-provided prices.
7. Add focused tests for public eligibility, discount expiration and invalidation, one-plan pairing, mixed plan intervals, rounding, FX outage and accessible/responsive rendering.

## Architecture boundaries / safety

- **Digital Solutions** owns catalog pricing, promotions, display quotes and checkout. **PayMongo** remains the hosted payment interface, **in PHP**. Do **not** resurrect retired first-party Payment Intents [PR #275](https://github.com/jan2xo/bke-digital-solutions/pull/275).
- This intent does not alter signed license trust, Agent/Launcher machine lifecycle, payment provider API, schema, production environment, or signing/checkout authority.
- If a proposed implementation changes payments, persistence/migrations, auth or shared authorization, **widen certification and review**. Display quote code must never accept authority over transactions.
- **Production locked:** no deploy, DB mutation, live PayMongo, public catalog mutation or merchant-setting change without separate explicit owner approval.

## Intentional certification plan

**Current draft state: DOCUMENTATION ONLY — no substantial certification invoked or claimed.** Allow only repository-configured cheap automatic PR Guard, if it runs.

For future **implementation** (provisional; recompute against actual changed source and exact head):

| Graph status | Proof ownership | Why |
| --- | --- | --- |
| Required | cheap PR Guard / repository hygiene | PR/plan and basic quality |
| Required | `v2-catalog` | canonical product/edition/plan selection and price presentation |
| Required | `v2-commerce` | public promotion preview, eligibility and amount correspondence |
| Required | targeted web/UI integration proof (confirm owning CI workflow) | USD/PHP display, responsive semantics, current/old price consistency |
| Conditional | `v2-composition`, `v2-host-v1-free`, `v2-payments` | only if changed host composition, Worker runtime or payment authority actually requires it |
| Not required for a presentation-only change | Licensing Agent, Launcher, installers, native publishing, independent payment canary, backup/restore, full suite | No behavior owned by those systems is modified |

Record final required/not-required graph with **exact PR head**; explicitly dispatch only applicable proof. A prior green SHA is stale if head changes. No merge before exact-head proof and review.

## Current outcome

- [x] Owner's USD-first / PHP-second and strikethrough discount decision captured.
- [x] Existing homepage/card vs product-detail pricing discrepancy traced to live source.
- [ ] Implementation not started.
- [ ] FX source/freshness contract not selected.
- [ ] Tests, certification and production deployment not started.

**This PR is an execution ledger, not a code implementation or release authorization.**

# V1 renewal pricing reconciliation and semi-annual billing

Canonical starting point: `main` at `4a0c6d000a6ec8c403bb170746d40be6aafbf85b`.
Scope: V1 only. No production database access, V2 edits, or changes to preserved `legacy/v1` were performed by the engineering work recorded here.

## Prerequisite: saved recurring terms own renewal invoices

Annual renewal preserved `Subscription.normalRecurringAmountMinor` for charging but used current catalog gross/discount components for the invoice. After a catalog edit those lines could disagree with the invoice/order/provider total.

The original subscription order already preserves the needed facts. Checkout now reads the original order item, matching account, currency, product, edition, plan, annual interval and quantity. It accepts an `OFFER_V1` annual breakdown only when its recorded monthly base, gross, discount rate, discount amount and catalog total reconcile exactly to the saved recurring charge under existing half-up rounding. Original promotional final amounts are never substituted for normal recurring amounts.

Missing, inconsistent, unknown-version, or unmapped history falls back to one normal-recurring-amount line. Any existing renewal promotion is then applied once, with its own discount line. Neither historical invoice components nor informational pricing/entitlement snapshots use today's annual discount to describe a saved renewal price. An equality guard rejects invoice lines that do not sum to the final charge.

No schema, migration, provider configuration, invoice design or calendar changes are needed for this prerequisite. Initial annual purchases and monthly charging retain existing semantics. Historical subscriptions whose normal recurring amount is null retain the existing current-catalog amount-selection behavior; they receive a single base line, are not backfilled, and are not represented as having saved historical economics.

## Verification contract

`tests/integration/renewal-pricing.test.ts` uses disposable PostgreSQL, real checkout and mock-provider settlement, and the actual PayMongo serializer with HTTP mocked. It independently compares outbound PayMongo line totals, persisted order/item totals, invoice totals and invoice-line sums. Cases include annual initial/renewal, unchanged catalog, monthly amount edits, annual discount edits, both edits, monthly renewal, missing/malformed history, legacy null recurring terms, and renewal promotions. Existing settlement replay guards are exercised. Unit coverage validates historical evidence and half-cent rounding.

All deployment-shaped commands in existing CI are checks/builds against test configuration, not production operations.

## Prerequisite certification

Prerequisite commit: `65085e2260fd427b4752139cc811bcc7f8e979e2`.
Both full V1 CI runs passed before feature implementation: [push run 34085018178](https://github.com/jan2xo/bke-digital-solutions/actions/runs/34085018178) and [PR run 34085026555](https://github.com/jan2xo/bke-digital-solutions/actions/runs/34085026555). Each certified 415 passing tests and 6 existing skips, followed by Next.js and Docker builds and all remaining existing gates.
The prerequisite changes exactly `lib/checkout.ts`, `lib/pricing.ts`, `tests/renewal-pricing.test.ts`, `tests/integration/renewal-pricing.test.ts`, and this report.

## First-class six-month plan

The existing purchase-plan enum gains `SEMI_ANNUAL`; the existing plan-to-monthly-source relation remains authoritative. The server maps MONTHLY to MONTH/1, SEMI_ANNUAL to MONTH/6, and ANNUAL to YEAR/1. PERPETUAL remains ONE_TIME with no recurring interval. Browsers still submit only a purchase-plan identifier and never an authoritative duration, discount or amount.

`PurchasePlan.semiAnnualDiscountBps` is a nullable, independently configured catalog discount on six-month plans. It reuses annual's basis-point, integer-minor-unit, half-up calculation mechanism and the current catalog discount range of 0–1,000 BPS (0–10%). An explicit `0` means the six-month plan has no catalog discount; `null` remains the distinct unconfigured state and is allowed only while that plan is inactive. Monthly times six is the gross basis. No annual-rate division or copy is used. Semi-annual gross is bounded by PostgreSQL Int because every invoice component must be storable.

The owner controls the six-month rate through the existing admin edition-plan controls, exactly as with the annual rate. No rate default, seed, backfill, or production product configuration is introduced by the implementation. Synthetic fixture rates are test inputs only and do not approve a commercial price.

`resolvePurchasePlan` returns the canonical total and a common term-pricing presentation object. The annual function and its rounding algorithm remain unchanged. Product selection and checkout review consume that object; invoices consume the same snapshot. The PayMongo adapter remains unchanged and receives the final canonical amount through its existing line-item serialization. Six-month snapshots use their own gross/discount keys. Annual and six-month renewals share the certified saved-term evidence hierarchy and single-line fallback, followed by any applicable existing promotion exactly once. Monthly-only promotional cycle eligibility is unchanged.

Calendar arithmetic remains in the existing entitlement engine. Six months uses `setUTCMonth(... + 6)`, not 180 days. Existing overflow is intentionally preserved: Jan 31 2026 + 1 month is Mar 3 2026; Aug 31 2026 + 6 months is Mar 3 2027; Feb 29 2024 + 1 year is Mar 1 2025. Early renewal starts at the current future period end. Initial and renewed license expiry must equal the subscription period end. Replay assertions compare invoice, payment, subscription and license state to prove settlement does not extend twice.

## Additive schema extension

- `20260907051000_semi_annual_plan_type`: add the enum value with IF NOT EXISTS. Separate migration completion allows PostgreSQL to commit the enum value before the next constraint references it.
- `20260907051100_semi_annual_plan_terms`: add nullable `semiAnnualDiscountBps`, without a default; extend the existing terms check atomically to allow semi-annual plans. Existing monthly, annual and perpetual predicates remain, with the new field required null for them.
- `20260907083000_allow_zero_semi_annual_discount`: follow-up additive constraint migration that makes semi-annual discount semantics match annual: configured values may be 0–10%, while null remains valid only for an inactive unconfigured semi-annual plan. The earlier migration is not edited, which keeps already-deployed migration history immutable.

No existing migration is edited, no existing rows are rewritten, and no subscription repricing occurs. Prisma client output does not change for the zero-discount follow-up because the Prisma field shape is unchanged; only the database check constraint and application validation semantics change. Full CI still requires generated-client drift checks, Prisma validation, migration status, migration replay no-op verification, database smoke checks and the production-shaped Docker build.

## Feature verification and operational boundary

`tests/semi-annual-pricing.test.ts` covers independent discount scope, explicit zero-percent configuration, tiny rates whose savings round to zero minor units, centavo rounding, database money limits, saved zero-discount snapshots, supported interval mapping, browser payload rejection and calendar overflow. `tests/integration/semi-annual-zero-discount.test.ts` directly certifies the PostgreSQL constraint: active six-month plans accept `0`, active null remains invalid, and inactive null remains the unconfigured state. `tests/integration/renewal-pricing.test.ts` exercises disposable PostgreSQL and actual checkout/settlement with the real PayMongo adapter's outbound HTTP payload intercepted. It compares line sum = invoice total = order total = PayMongo amount for all three recurring purchase intervals, renewals, changed catalog terms, promotions and replay behavior.

`tests/e2e/semi-annual.spec.ts` runs Chromium against a disposable Next.js server, verifies all three selectable plans and independent displayed prices, and clicks through with the canonical six-month plan ID preserved in the sign-in return URL. It uses the existing Playwright dependency/configuration. Browser installation follows the [official Playwright CI instructions](https://playwright.dev/docs/ci); no new test service or dependency is introduced.

The original semi-annual implementation was merged through PR #147 at merge commit `8d9199356f71d71326c5b1d3ca795174aedc2933` after exact-candidate CI and post-merge `main` CI passed. The zero-discount correction is a follow-up compatibility fix and requires its own CI/merge evidence before deployment.

Engineering certification uses disposable PostgreSQL, mocked payment HTTP and mock-provider settlement. It is not a live PayMongo transaction or automatic production deployment. Production migration and deployment remain explicit owner operations.

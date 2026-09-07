# V1 renewal pricing reconciliation and semi-annual billing

Canonical starting point: `main` at `4a0c6d000a6ec8c403bb170746d40be6aafbf85b`.
Scope: V1 only, feature branch `feat/v1-semi-annual-billing`, PR only. No deployment, production database access, V2 edits, or changes to preserved `legacy/v1`.

## Prerequisite: saved recurring terms own renewal invoices

Annual renewal preserved `Subscription.normalRecurringAmountMinor` for charging but used current catalog gross/discount components for the invoice. After a catalog edit those lines could disagree with the invoice/order/provider total.

The original subscription order already preserves the needed facts. Checkout now reads the original order item, matching account, currency, product, edition, plan, annual interval and quantity. It accepts an `OFFER_V1` annual breakdown only when its recorded monthly base, gross, discount rate, discount amount and catalog total reconcile exactly to the saved recurring charge under existing half-up rounding. Original promotional final amounts are never substituted for normal recurring amounts.

Missing, inconsistent, unknown-version, or unmapped history falls back to one normal-recurring-amount line. Any existing renewal promotion is then applied once, with its own discount line. Neither historical invoice components nor informational pricing/entitlement snapshots use today's annual discount to describe a saved renewal price. An equality guard rejects invoice lines that do not sum to the final charge.

No schema, migration, provider configuration, invoice design or calendar changes are needed for this prerequisite. Initial annual purchases and monthly charging retain existing semantics. Historical subscriptions whose normal recurring amount is null retain the existing current-catalog amount-selection behavior; they receive a single base line, are not backfilled, and are not represented as having saved historical economics.

## Verification contract

`tests/integration/renewal-pricing.test.ts` uses disposable PostgreSQL, real checkout and mock-provider settlement, and the actual PayMongo serializer with HTTP mocked. It independently compares outbound PayMongo line totals, persisted order/item totals, invoice totals and invoice-line sums. Cases include annual initial/renewal, unchanged catalog, monthly amount edits, annual discount edits, both edits, monthly renewal, missing/malformed history, legacy null recurring terms, and renewal promotions. Existing settlement replay guards are exercised. Unit coverage validates historical evidence and half-cent rounding.

All deployment-shaped commands in existing CI are checks/builds against test configuration, not production operations. CI evidence belongs to the exact candidate commit and must be inspected before proceeding to the semi-annual feature.

## Semi-annual status

Not implemented in the prerequisite commit. The owner requires configurable semi-annual discount scope and has not yet supplied a commercial numeric rate. Do not infer annual / 2 or expose an undiscounted six-month fallback. Implement only after prerequisite certification passes.

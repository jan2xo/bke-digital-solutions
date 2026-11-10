-- Repair the legacy three-plan invariant after SEMI_ANNUAL enum/column expansion.
-- The two earlier production-applied migrations remain immutable. Replace the
-- constraint atomically, preserving the existing PERPETUAL/MONTHLY/ANNUAL terms
-- and recognizing the new six-month plan with the same monthly source policy.
-- No orders, invoices, payments, entitlement history, or existing rows change.
ALTER TABLE "PurchasePlan"
  DROP CONSTRAINT "PurchasePlan_terms_check",
  ADD CONSTRAINT "PurchasePlan_terms_check" CHECK (
    (
      "type" = 'ANNUAL'
      AND "amountMinor" IS NULL
      AND "annualDiscountBps" BETWEEN 0 AND 1000
      AND "monthlySourcePlanId" IS NOT NULL
      AND "renewalBehavior" = 'CUSTOMER_AUTHORIZED'
    )
    OR (
      "type" = 'MONTHLY'
      AND "amountMinor" > 0
      AND "annualDiscountBps" IS NULL
      AND "monthlySourcePlanId" IS NULL
      AND "renewalBehavior" = 'CUSTOMER_AUTHORIZED'
    )
    OR (
      "type" = 'PERPETUAL'
      AND "amountMinor" > 0
      AND "annualDiscountBps" IS NULL
      AND "monthlySourcePlanId" IS NULL
      AND "renewalBehavior" = 'NONE'
    )
    OR (
      "type" = 'SEMI_ANNUAL'
      AND "amountMinor" IS NULL
      AND "annualDiscountBps" IS NULL
      AND (
        "semiAnnualDiscountBps" BETWEEN 0 AND 1000
        OR ("active" = FALSE AND "semiAnnualDiscountBps" IS NULL)
      )
      AND "monthlySourcePlanId" IS NOT NULL
      AND "renewalBehavior" = 'CUSTOMER_AUTHORIZED'
    )
  );

-- A billing interval does not require a catalog discount.
-- Preserve null as the explicit unconfigured state for inactive semi-annual plans,
-- while allowing configured active or inactive plans to use 0-10% just like annual.
ALTER TABLE "PurchasePlan" DROP CONSTRAINT "PurchasePlan_terms_check",
ADD CONSTRAINT "PurchasePlan_terms_check" CHECK (
  ("type" = 'ANNUAL' AND "amountMinor" IS NULL AND "annualDiscountBps" BETWEEN 0 AND 1000 AND "monthlySourcePlanId" IS NOT NULL AND "renewalBehavior" = 'CUSTOMER_AUTHORIZED' AND "semiAnnualDiscountBps" IS NULL)
  OR
  ("type" = 'MONTHLY' AND "amountMinor" > 0 AND "annualDiscountBps" IS NULL AND "monthlySourcePlanId" IS NULL AND "renewalBehavior" = 'CUSTOMER_AUTHORIZED' AND "semiAnnualDiscountBps" IS NULL)
  OR
  ("type" = 'PERPETUAL' AND "amountMinor" > 0 AND "annualDiscountBps" IS NULL AND "monthlySourcePlanId" IS NULL AND "renewalBehavior" = 'NONE' AND "semiAnnualDiscountBps" IS NULL)
  OR
  ("type" = 'SEMI_ANNUAL' AND "amountMinor" IS NULL AND "annualDiscountBps" IS NULL AND "monthlySourcePlanId" IS NOT NULL AND "renewalBehavior" = 'CUSTOMER_AUTHORIZED'
    AND (("semiAnnualDiscountBps" IS NULL AND NOT "active") OR ("semiAnnualDiscountBps" IS NOT NULL AND "semiAnnualDiscountBps" BETWEEN 0 AND 1000)))
);

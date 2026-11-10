-- Never rewrite commercial history: only new plan policy column and checks.
ALTER TABLE "PurchasePlan" ADD COLUMN "semiAnnualDiscountBps" INTEGER;

ALTER TABLE "PurchasePlan"
  ADD CONSTRAINT "PurchasePlan_semi_annual_discount_bounds"
  CHECK ("semiAnnualDiscountBps" IS NULL OR "semiAnnualDiscountBps" BETWEEN 0 AND 1000);

ALTER TABLE "PurchasePlan"
  ADD CONSTRAINT "PurchasePlan_active_semi_annual_terms"
  CHECK (
    "type" <> 'SEMI_ANNUAL' OR "active" = FALSE OR
    ("semiAnnualDiscountBps" IS NOT NULL AND "monthlySourcePlanId" IS NOT NULL)
  );

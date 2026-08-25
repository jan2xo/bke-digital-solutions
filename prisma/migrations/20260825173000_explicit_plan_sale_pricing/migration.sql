-- Explicit ecommerce list vs selling price for every purchase plan.
ALTER TABLE "PurchasePlan" ADD COLUMN "listAmountMinor" INTEGER;

-- Preserve existing behavior until an administrator enters an explicit list price.
UPDATE "PurchasePlan"
SET "listAmountMinor" = "amountMinor"
WHERE "amountMinor" IS NOT NULL;

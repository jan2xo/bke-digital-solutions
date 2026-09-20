-- CreateEnum
CREATE TYPE "PurchasePlanType" AS ENUM ('PERPETUAL', 'MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "RenewalBehavior" AS ENUM ('NONE', 'CUSTOMER_AUTHORIZED');

-- CreateEnum
CREATE TYPE "UpdatePolicy" AS ENUM ('LIFETIME', 'ACTIVE_TERM', 'MAJOR_VERSION');

-- AlterTable
ALTER TABLE "License" ADD COLUMN     "editionId" TEXT,
ADD COLUMN     "purchasePlanId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "editionId" TEXT,
ADD COLUMN     "editionName" TEXT,
ADD COLUMN     "entitlementSnapshot" JSONB,
ADD COLUMN     "intervalCount" INTEGER,
ADD COLUMN     "intervalUnit" "IntervalUnit",
ADD COLUMN     "planName" TEXT,
ADD COLUMN     "planType" "PurchasePlanType",
ADD COLUMN     "purchasePlanId" TEXT,
ADD COLUMN     "renewalBehavior" "RenewalBehavior";

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "editionId" TEXT,
ADD COLUMN     "purchasePlanId" TEXT;

-- CreateTable
CREATE TABLE "Edition" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "features" JSONB NOT NULL DEFAULT '[]',
    "maxUsers" INTEGER NOT NULL DEFAULT 1,
    "maxDevicesPerUser" INTEGER NOT NULL DEFAULT 1,
    "updatePolicy" "UpdatePolicy" NOT NULL DEFAULT 'LIFETIME',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Edition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchasePlan" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "type" "PurchasePlanType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "amountMinor" INTEGER,
    "annualDiscountBps" INTEGER,
    "renewalBehavior" "RenewalBehavior" NOT NULL DEFAULT 'NONE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "monthlySourcePlanId" TEXT,
    "legacyPriceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchasePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Edition_productId_active_sortOrder_idx" ON "Edition"("productId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Edition_productId_slug_key" ON "Edition"("productId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasePlan_legacyPriceId_key" ON "PurchasePlan"("legacyPriceId");

-- CreateIndex
CREATE INDEX "PurchasePlan_editionId_active_idx" ON "PurchasePlan"("editionId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasePlan_editionId_type_key" ON "PurchasePlan"("editionId", "type");

-- AddForeignKey
ALTER TABLE "Edition" ADD CONSTRAINT "Edition_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePlan" ADD CONSTRAINT "PurchasePlan_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "Edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePlan" ADD CONSTRAINT "PurchasePlan_monthlySourcePlanId_fkey" FOREIGN KEY ("monthlySourcePlanId") REFERENCES "PurchasePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePlan" ADD CONSTRAINT "PurchasePlan_legacyPriceId_fkey" FOREIGN KEY ("legacyPriceId") REFERENCES "Price"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "Edition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_purchasePlanId_fkey" FOREIGN KEY ("purchasePlanId") REFERENCES "PurchasePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "Edition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_purchasePlanId_fkey" FOREIGN KEY ("purchasePlanId") REFERENCES "PurchasePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain constraints: annual totals are derived and therefore never stored.
ALTER TABLE "Edition" ADD CONSTRAINT "Edition_limits_check" CHECK ("maxUsers" > 0 AND "maxDevicesPerUser" > 0);
ALTER TABLE "PurchasePlan" ADD CONSTRAINT "PurchasePlan_terms_check" CHECK (
  ("type" = 'ANNUAL' AND "amountMinor" IS NULL AND "annualDiscountBps" BETWEEN 0 AND 1000 AND "monthlySourcePlanId" IS NOT NULL AND "renewalBehavior" = 'CUSTOMER_AUTHORIZED')
  OR
  ("type" = 'MONTHLY' AND "amountMinor" > 0 AND "annualDiscountBps" IS NULL AND "monthlySourcePlanId" IS NULL AND "renewalBehavior" = 'CUSTOMER_AUTHORIZED')
  OR
  ("type" = 'PERPETUAL' AND "amountMinor" > 0 AND "annualDiscountBps" IS NULL AND "monthlySourcePlanId" IS NULL AND "renewalBehavior" = 'NONE')
);

-- Backfill one edition for every existing policy. Historical Price, OrderItem,
-- Invoice, Payment, License, DownloadGrant, and AuditLog values remain untouched.
INSERT INTO "Edition" (
  "id", "productId", "slug", "name", "description", "features",
  "maxUsers", "maxDevicesPerUser", "updatePolicy", "active", "sortOrder",
  "createdAt", "updatedAt"
)
SELECT
  'c' || substr(md5('edition:' || policy."id"), 1, 24),
  policy."productId",
  'legacy-' || substr(md5(policy."id"), 1, 12),
  policy."name",
  'Migrated from the existing license policy.',
  policy."rules",
  policy."maxSeats",
  policy."maxDevicesPerSeat",
  CASE WHEN EXISTS (
    SELECT 1 FROM "Price" price
    WHERE price."licensePolicyId" = policy."id" AND price."billingType" = 'SUBSCRIPTION'
  ) THEN 'ACTIVE_TERM'::"UpdatePolicy" ELSE 'LIFETIME'::"UpdatePolicy" END,
  true,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "LicensePolicy" policy;

-- Existing perpetual and monthly prices map directly to plans.
INSERT INTO "PurchasePlan" (
  "id", "editionId", "type", "currency", "amountMinor", "annualDiscountBps",
  "renewalBehavior", "active", "monthlySourcePlanId", "legacyPriceId",
  "createdAt", "updatedAt"
)
SELECT DISTINCT ON (price."licensePolicyId", price."billingType", price."intervalUnit")
  'c' || substr(md5('plan:' || price."id"), 1, 24),
  'c' || substr(md5('edition:' || price."licensePolicyId"), 1, 24),
  CASE WHEN price."billingType" = 'ONE_TIME' THEN 'PERPETUAL'::"PurchasePlanType" ELSE 'MONTHLY'::"PurchasePlanType" END,
  price."currency",
  price."amountMinor",
  NULL,
  CASE WHEN price."billingType" = 'ONE_TIME' THEN 'NONE'::"RenewalBehavior" ELSE 'CUSTOMER_AUTHORIZED'::"RenewalBehavior" END,
  price."active",
  NULL,
  price."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Price" price
WHERE price."billingType" = 'ONE_TIME'
   OR (price."billingType" = 'SUBSCRIPTION' AND price."intervalUnit" = 'MONTH')
ORDER BY price."licensePolicyId", price."billingType", price."intervalUnit", price."active" DESC, price."id";

-- An annual plan must have a monthly source. For legacy annual-only offerings,
-- derive a monthly source and basis-point discount that reproduces the current
-- annual catalog amount exactly under the application's half-up formula.
WITH annual_prices AS (
  SELECT DISTINCT ON (price."licensePolicyId") price.*
  FROM "Price" price
  WHERE price."billingType" = 'SUBSCRIPTION' AND price."intervalUnit" = 'YEAR'
  ORDER BY price."licensePolicyId", price."active" DESC, price."id"
), derived AS (
  SELECT annual_prices.*, candidate.monthly_amount, candidate.discount_bps
  FROM annual_prices
  CROSS JOIN LATERAL (
    SELECT monthly_candidate AS monthly_amount, discount_candidate AS discount_bps
    FROM generate_series(0, 1000) AS discount_candidate
    CROSS JOIN LATERAL generate_series(
      GREATEST(1, round((annual_prices."amountMinor"::numeric * 10000) / (12 * (10000 - discount_candidate)))::integer - 2),
      round((annual_prices."amountMinor"::numeric * 10000) / (12 * (10000 - discount_candidate)))::integer + 2
    ) AS monthly_candidate
    WHERE ((monthly_candidate::bigint * 12 * (10000 - discount_candidate) + 5000) / 10000)::integer = annual_prices."amountMinor"
    ORDER BY discount_candidate, monthly_candidate
    LIMIT 1
  ) candidate
)
INSERT INTO "PurchasePlan" (
  "id", "editionId", "type", "currency", "amountMinor", "annualDiscountBps",
  "renewalBehavior", "active", "monthlySourcePlanId", "legacyPriceId",
  "createdAt", "updatedAt"
)
SELECT
  'c' || substr(md5('monthly-source:' || derived."id"), 1, 24),
  'c' || substr(md5('edition:' || derived."licensePolicyId"), 1, 24),
  'MONTHLY'::"PurchasePlanType",
  derived."currency",
  derived.monthly_amount,
  NULL,
  'CUSTOMER_AUTHORIZED'::"RenewalBehavior",
  true,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM derived
WHERE NOT EXISTS (
  SELECT 1 FROM "PurchasePlan" existing
  WHERE existing."editionId" = 'c' || substr(md5('edition:' || derived."licensePolicyId"), 1, 24)
    AND existing."type" = 'MONTHLY'
);

WITH annual_prices AS (
  SELECT DISTINCT ON (price."licensePolicyId") price.*
  FROM "Price" price
  WHERE price."billingType" = 'SUBSCRIPTION' AND price."intervalUnit" = 'YEAR'
  ORDER BY price."licensePolicyId", price."active" DESC, price."id"
), monthly_sources AS (
  SELECT annual_prices.*, monthly."id" AS monthly_plan_id, monthly."amountMinor" AS monthly_amount
  FROM annual_prices
  JOIN "PurchasePlan" monthly
    ON monthly."editionId" = 'c' || substr(md5('edition:' || annual_prices."licensePolicyId"), 1, 24)
   AND monthly."type" = 'MONTHLY'
), derived AS (
  SELECT monthly_sources.*, discount.discount_bps
  FROM monthly_sources
  CROSS JOIN LATERAL (
    SELECT discount_candidate AS discount_bps
    FROM generate_series(0, 1000) AS discount_candidate
    WHERE ((monthly_sources.monthly_amount::bigint * 12 * (10000 - discount_candidate) + 5000) / 10000)::integer = monthly_sources."amountMinor"
    ORDER BY discount_candidate
    LIMIT 1
  ) discount
)
INSERT INTO "PurchasePlan" (
  "id", "editionId", "type", "currency", "amountMinor", "annualDiscountBps",
  "renewalBehavior", "active", "monthlySourcePlanId", "legacyPriceId",
  "createdAt", "updatedAt"
)
SELECT
  'c' || substr(md5('plan:' || derived."id"), 1, 24),
  'c' || substr(md5('edition:' || derived."licensePolicyId"), 1, 24),
  'ANNUAL'::"PurchasePlanType",
  derived."currency",
  NULL,
  derived.discount_bps,
  'CUSTOMER_AUTHORIZED'::"RenewalBehavior",
  derived."active",
  derived.monthly_plan_id,
  derived."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM derived;

-- Link existing entitlements to their mapped edition/plan without changing
-- any historical amount, status, date, snapshot, invoice, or payment field.
UPDATE "License" license
SET "purchasePlanId" = plan."id", "editionId" = plan."editionId"
FROM "OrderItem" item
JOIN "PurchasePlan" plan ON plan."legacyPriceId" = item."priceId"
WHERE license."orderItemId" = item."id";

UPDATE "Subscription" subscription
SET "purchasePlanId" = plan."id", "editionId" = plan."editionId"
FROM "OrderItem" item
JOIN "PurchasePlan" plan ON plan."legacyPriceId" = item."priceId"
WHERE subscription."orderId" = item."orderId"
  AND subscription."productId" = item."productId";

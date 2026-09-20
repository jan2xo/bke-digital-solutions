-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('GENERAL_PROMOTION', 'CUSTOMER_ACCOUNT_OFFER', 'ADMINISTRATIVE_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "DiscountStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OfferRedemptionStatus" AS ENUM ('RESERVED', 'APPLIED', 'RELEASED', 'REFUNDED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "renewalSubscriptionId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "catalogAmountMinor" INTEGER,
ADD COLUMN     "offerDiscountBps" INTEGER,
ADD COLUMN     "offerDiscountMinor" INTEGER,
ADD COLUMN     "offerId" TEXT,
ADD COLUMN     "pricingSnapshot" JSONB,
ADD COLUMN     "pricingVersion" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "discountedCyclesConsumed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountedCyclesTotal" INTEGER,
ADD COLUMN     "discountedRecurringAmountMinor" INTEGER,
ADD COLUMN     "normalRecurringAmountMinor" INTEGER,
ADD COLUMN     "offerId" TEXT,
ADD COLUMN     "offerSnapshot" JSONB,
ADD COLUMN     "pricingVersion" TEXT,
ADD COLUMN     "promotionalDiscountBps" INTEGER;

-- CreateTable
CREATE TABLE "DiscountOffer" (
    "id" TEXT NOT NULL,
    "codeNormalized" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "DiscountType" NOT NULL,
    "status" "DiscountStatus" NOT NULL DEFAULT 'DRAFT',
    "discountBps" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "productId" TEXT,
    "editionId" TEXT,
    "purchasePlanId" TEXT,
    "customerAccountId" TEXT,
    "maximumRedemptions" INTEGER,
    "perAccountRedemptionLimit" INTEGER,
    "discountedBillingCycles" INTEGER,
    "allowZeroTotal" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DiscountOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferRedemption" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "OfferRedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "discountBps" INTEGER NOT NULL,
    "baseMinor" INTEGER NOT NULL,
    "discountMinor" INTEGER NOT NULL,
    "finalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "pricingVersion" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "OfferRedemption_pkey" PRIMARY KEY ("id")
);

-- Domain invariants are enforced in PostgreSQL as a final safety boundary.
ALTER TABLE "DiscountOffer"
  ADD CONSTRAINT "DiscountOffer_discountBps_check" CHECK ("discountBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "DiscountOffer_dates_check" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt"),
  ADD CONSTRAINT "DiscountOffer_maximumRedemptions_check" CHECK ("maximumRedemptions" IS NULL OR "maximumRedemptions" > 0),
  ADD CONSTRAINT "DiscountOffer_perAccountRedemptionLimit_check" CHECK ("perAccountRedemptionLimit" IS NULL OR "perAccountRedemptionLimit" > 0),
  ADD CONSTRAINT "DiscountOffer_discountedBillingCycles_check" CHECK ("discountedBillingCycles" IS NULL OR "discountedBillingCycles" BETWEEN 1 AND 12),
  ADD CONSTRAINT "DiscountOffer_zeroTotal_check" CHECK (NOT "allowZeroTotal" OR "discountBps" = 10000),
  ADD CONSTRAINT "DiscountOffer_customerScope_check" CHECK ("type" <> 'CUSTOMER_ACCOUNT_OFFER' OR "customerAccountId" IS NOT NULL);

ALTER TABLE "OfferRedemption"
  ADD CONSTRAINT "OfferRedemption_discountBps_check" CHECK ("discountBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "OfferRedemption_amounts_check" CHECK (
    "baseMinor" > 0 AND "discountMinor" >= 0 AND "finalMinor" >= 0
    AND "discountMinor" <= "baseMinor" AND "finalMinor" <= "baseMinor"
    AND "discountMinor" + "finalMinor" = "baseMinor"
  );

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_discountedCycles_check" CHECK (
    ("discountedCyclesTotal" IS NULL AND "discountedCyclesConsumed" = 0)
    OR ("discountedCyclesTotal" BETWEEN 1 AND 12 AND "discountedCyclesConsumed" BETWEEN 0 AND "discountedCyclesTotal")
  );

-- CreateIndex
CREATE UNIQUE INDEX "DiscountOffer_codeNormalized_key" ON "DiscountOffer"("codeNormalized");

-- CreateIndex
CREATE INDEX "DiscountOffer_status_startsAt_endsAt_idx" ON "DiscountOffer"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "DiscountOffer_customerAccountId_status_idx" ON "DiscountOffer"("customerAccountId", "status");

-- CreateIndex
CREATE INDEX "DiscountOffer_purchasePlanId_status_idx" ON "DiscountOffer"("purchasePlanId", "status");

-- CreateIndex
CREATE INDEX "Order_renewalSubscriptionId_idx" ON "Order"("renewalSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferRedemption_orderId_key" ON "OfferRedemption"("orderId");

-- CreateIndex
CREATE INDEX "OfferRedemption_offerId_status_idx" ON "OfferRedemption"("offerId", "status");

-- CreateIndex
CREATE INDEX "OfferRedemption_offerId_accountId_status_idx" ON "OfferRedemption"("offerId", "accountId", "status");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_renewalSubscriptionId_fkey" FOREIGN KEY ("renewalSubscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountOffer" ADD CONSTRAINT "DiscountOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountOffer" ADD CONSTRAINT "DiscountOffer_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "Edition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountOffer" ADD CONSTRAINT "DiscountOffer_purchasePlanId_fkey" FOREIGN KEY ("purchasePlanId") REFERENCES "PurchasePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountOffer" ADD CONSTRAINT "DiscountOffer_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountOffer" ADD CONSTRAINT "DiscountOffer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "DiscountOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

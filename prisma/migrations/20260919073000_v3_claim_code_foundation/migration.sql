-- V3 account-first licensing foundation.
-- Existing orders remain direct account entitlements by default.
-- Claim-code checkout is not exposed until settlement routing is wired.

CREATE TYPE "PurchaseFulfillmentMode" AS ENUM ('ACCOUNT_ENTITLEMENT', 'CLAIM_CODE');
CREATE TYPE "ClaimCodeStatus" AS ENUM ('AVAILABLE', 'CLAIMED', 'REVOKED', 'EXPIRED');

ALTER TABLE "Order"
  ADD COLUMN "fulfillmentMode" "PurchaseFulfillmentMode" NOT NULL DEFAULT 'ACCOUNT_ENTITLEMENT';

CREATE TABLE "ClaimCode" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "unitIndex" INTEGER NOT NULL,
  "purchaserAccountId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "codeCiphertext" TEXT,
  "codeLastFour" TEXT NOT NULL,
  "status" "ClaimCodeStatus" NOT NULL DEFAULT 'AVAILABLE',
  "resourceId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "editionId" TEXT,
  "purchasePlanId" TEXT,
  "scopeSnapshot" JSONB NOT NULL,
  "grantSnapshot" JSONB NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "claimedByUserId" TEXT,
  "claimedToAccountId" TEXT,
  "entitlementId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClaimCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClaimCode_unitIndex_check" CHECK ("unitIndex" >= 0),
  CONSTRAINT "ClaimCode_validity_check" CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom"),
  CONSTRAINT "ClaimCode_claim_shape_check" CHECK (
    ("status" <> 'CLAIMED') OR
    ("claimedAt" IS NOT NULL AND "claimedByUserId" IS NOT NULL AND "claimedToAccountId" IS NOT NULL AND "entitlementId" IS NOT NULL)
  ),
  CONSTRAINT "ClaimCode_revoked_shape_check" CHECK (
    ("status" <> 'REVOKED') OR "revokedAt" IS NOT NULL
  ),
  CONSTRAINT "ClaimCode_secret_shape_check" CHECK (
    (("status" = 'AVAILABLE') AND "codeCiphertext" IS NOT NULL)
    OR
    (("status" <> 'AVAILABLE') AND "codeCiphertext" IS NULL)
  )
);

CREATE UNIQUE INDEX "ClaimCode_codeHash_key" ON "ClaimCode"("codeHash");
CREATE UNIQUE INDEX "ClaimCode_entitlementId_key" ON "ClaimCode"("entitlementId");
CREATE UNIQUE INDEX "ClaimCode_orderItemId_unitIndex_key" ON "ClaimCode"("orderItemId", "unitIndex");
CREATE INDEX "ClaimCode_purchaserAccountId_status_idx" ON "ClaimCode"("purchaserAccountId", "status");
CREATE INDEX "ClaimCode_claimedToAccountId_claimedAt_idx" ON "ClaimCode"("claimedToAccountId", "claimedAt");
CREATE INDEX "ClaimCode_orderId_idx" ON "ClaimCode"("orderId");
CREATE INDEX "ClaimCode_status_expiresAt_idx" ON "ClaimCode"("status", "expiresAt");

ALTER TABLE "ClaimCode"
  ADD CONSTRAINT "ClaimCode_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClaimCode"
  ADD CONSTRAINT "ClaimCode_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClaimCode"
  ADD CONSTRAINT "ClaimCode_purchaserAccountId_fkey"
  FOREIGN KEY ("purchaserAccountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClaimCode"
  ADD CONSTRAINT "ClaimCode_claimedByUserId_fkey"
  FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClaimCode"
  ADD CONSTRAINT "ClaimCode_claimedToAccountId_fkey"
  FOREIGN KEY ("claimedToAccountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClaimCode"
  ADD CONSTRAINT "ClaimCode_entitlementId_fkey"
  FOREIGN KEY ("entitlementId") REFERENCES "Entitlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

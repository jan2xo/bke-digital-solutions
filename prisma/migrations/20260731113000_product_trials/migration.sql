CREATE TYPE "TrialSource" AS ENUM ('SELF_SERVICE', 'ADMIN');

CREATE TABLE "TrialGrant" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "editionId" TEXT NOT NULL,
  "licenseId" TEXT NOT NULL,
  "source" "TrialSource" NOT NULL,
  "selfServiceYear" INTEGER,
  "trialStartsAt" TIMESTAMP(3) NOT NULL,
  "trialEndsAt" TIMESTAMP(3) NOT NULL,
  "graceEndsAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrialGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrialGrant_dates_check" CHECK ("trialEndsAt" > "trialStartsAt" AND "graceEndsAt" >= "trialEndsAt")
);

CREATE UNIQUE INDEX "TrialGrant_licenseId_key" ON "TrialGrant"("licenseId");
CREATE UNIQUE INDEX "TrialGrant_accountId_productId_selfServiceYear_key" ON "TrialGrant"("accountId", "productId", "selfServiceYear");
CREATE INDEX "TrialGrant_accountId_graceEndsAt_idx" ON "TrialGrant"("accountId", "graceEndsAt");
CREATE INDEX "TrialGrant_productId_createdAt_idx" ON "TrialGrant"("productId", "createdAt");
ALTER TABLE "TrialGrant" ADD CONSTRAINT "TrialGrant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrialGrant" ADD CONSTRAINT "TrialGrant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrialGrant" ADD CONSTRAINT "TrialGrant_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "Edition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrialGrant" ADD CONSTRAINT "TrialGrant_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

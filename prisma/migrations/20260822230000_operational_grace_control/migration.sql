CREATE TABLE "ProductGraceOverride" (
    "id" TEXT NOT NULL,
    "productKey" TEXT NOT NULL,
    "graceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductGraceOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductGraceOverride_productKey_key" ON "ProductGraceOverride"("productKey");

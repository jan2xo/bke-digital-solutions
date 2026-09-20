CREATE TABLE "CommercialLeaseOperation" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultLeaseId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "CommercialLeaseOperation_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "LicenseLeaseRecord" ADD COLUMN "operationId" TEXT;
ALTER TABLE "LicenseLeaseRecord" ADD COLUMN "signerKeyId" TEXT;
ALTER TABLE "LicenseLeaseRecord" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "LicenseLeaseRecord" ADD COLUMN "leasePayload" TEXT;
ALTER TABLE "LicenseLeaseRecord" ADD COLUMN "leaseSignature" TEXT;
CREATE UNIQUE INDEX "CommercialLeaseOperation_operationId_key" ON "CommercialLeaseOperation"("operationId");
CREATE UNIQUE INDEX "CommercialLeaseOperation_resultLeaseId_key" ON "CommercialLeaseOperation"("resultLeaseId");
CREATE UNIQUE INDEX "LicenseLeaseRecord_operationId_key" ON "LicenseLeaseRecord"("operationId");
ALTER TABLE "CommercialLeaseOperation" ADD CONSTRAINT "CommercialLeaseOperation_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialLeaseOperation" ADD CONSTRAINT "CommercialLeaseOperation_resultLeaseId_fkey" FOREIGN KEY ("resultLeaseId") REFERENCES "LicenseLeaseRecord"("leaseId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LicenseLeaseRecord" ADD CONSTRAINT "LicenseLeaseRecord_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "CommercialLeaseOperation"("operationId") ON DELETE RESTRICT ON UPDATE CASCADE;

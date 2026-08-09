CREATE TABLE "LicenseLeaseRecord" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "serverRevision" INTEGER NOT NULL,
    "installationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "supersededById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LicenseLeaseRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LicenseLeaseRecord_leaseId_key" ON "LicenseLeaseRecord"("leaseId");
CREATE INDEX "LicenseLeaseRecord_licenseId_installationId_deviceId_generation_serverRevision_idx" ON "LicenseLeaseRecord"("licenseId", "installationId", "deviceId", "generation", "serverRevision");
ALTER TABLE "LicenseLeaseRecord" ADD CONSTRAINT "LicenseLeaseRecord_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LicenseLeaseRecord" ADD CONSTRAINT "LicenseLeaseRecord_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "LicenseLeaseRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

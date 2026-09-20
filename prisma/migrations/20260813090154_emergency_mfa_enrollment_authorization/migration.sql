-- DropIndex
DROP INDEX "DownloadGrant_processingAt_idx";

-- AlterTable
ALTER TABLE "LicenseLeaseRecord" ALTER COLUMN "action" DROP DEFAULT;

-- CreateTable
CREATE TABLE "EmergencyMfaEnrollmentAuthorization" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "recoveryReason" TEXT NOT NULL,
    "operatorIdentity" TEXT NOT NULL,
    "ownerKeyVersion" INTEGER NOT NULL,
    "deploymentEnvironment" TEXT NOT NULL,

    CONSTRAINT "EmergencyMfaEnrollmentAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyMfaEnrollmentAuthorization_tokenHash_key" ON "EmergencyMfaEnrollmentAuthorization"("tokenHash");

-- CreateIndex
CREATE INDEX "EmergencyMfaEnrollmentAuthorization_userId_expiresAt_consum_idx" ON "EmergencyMfaEnrollmentAuthorization"("userId", "expiresAt", "consumedAt");

-- CreateIndex
CREATE INDEX "CommercialLeaseOperation_licenseId_action_status_idx" ON "CommercialLeaseOperation"("licenseId", "action", "status");

-- AddForeignKey
ALTER TABLE "EmergencyMfaEnrollmentAuthorization" ADD CONSTRAINT "EmergencyMfaEnrollmentAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "LicenseLeaseRecord_licenseId_installationId_deviceId_generation" RENAME TO "LicenseLeaseRecord_licenseId_installationId_deviceId_genera_idx";

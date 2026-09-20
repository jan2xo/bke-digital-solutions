CREATE TYPE "ExternalProvider" AS ENUM ('PAYMONGO', 'RESEND');
CREATE TYPE "ProviderEnvironment" AS ENUM ('TEST', 'LIVE');
CREATE TYPE "ProviderCredentialType" AS ENUM ('SECRET_KEY', 'WEBHOOK_SECRET', 'API_KEY');
CREATE TYPE "ProviderValidationStatus" AS ENUM ('NOT_VALIDATED', 'VALID', 'INVALID');

CREATE TABLE "ExternalProviderConfiguration" (
  "id" TEXT NOT NULL,
  "provider" "ExternalProvider" NOT NULL,
  "environment" "ProviderEnvironment" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "senderName" TEXT,
  "senderEmail" TEXT,
  "supportEmail" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "validationStatus" "ProviderValidationStatus" NOT NULL DEFAULT 'NOT_VALIDATED',
  "lastValidatedAt" TIMESTAMP(3),
  "lastValidationCode" TEXT,
  "lastRotatedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalProviderConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalProviderCredential" (
  "id" TEXT NOT NULL,
  "configurationId" TEXT NOT NULL,
  "credentialType" "ProviderCredentialType" NOT NULL,
  "encryptedValue" TEXT NOT NULL,
  "encryptionKeyVersion" INTEGER NOT NULL,
  "maskedHint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "replacedByCredentialId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  CONSTRAINT "ExternalProviderCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalProviderCredential_key_version_check" CHECK ("encryptionKeyVersion" > 0)
);

CREATE UNIQUE INDEX "ExternalProviderConfiguration_provider_environment_key" ON "ExternalProviderConfiguration"("provider", "environment");
CREATE INDEX "ExternalProviderConfiguration_enabled_provider_environment_idx" ON "ExternalProviderConfiguration"("enabled", "provider", "environment");
CREATE INDEX "ExternalProviderCredential_configurationId_credentialType_revokedAt_idx" ON "ExternalProviderCredential"("configurationId", "credentialType", "revokedAt");
CREATE INDEX "ExternalProviderCredential_encryptionKeyVersion_revokedAt_idx" ON "ExternalProviderCredential"("encryptionKeyVersion", "revokedAt");
CREATE UNIQUE INDEX "ExternalProviderCredential_one_active_type" ON "ExternalProviderCredential"("configurationId", "credentialType") WHERE "revokedAt" IS NULL;

ALTER TABLE "ExternalProviderConfiguration" ADD CONSTRAINT "ExternalProviderConfiguration_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalProviderConfiguration" ADD CONSTRAINT "ExternalProviderConfiguration_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalProviderCredential" ADD CONSTRAINT "ExternalProviderCredential_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "ExternalProviderConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalProviderCredential" ADD CONSTRAINT "ExternalProviderCredential_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalProviderCredential" ADD CONSTRAINT "ExternalProviderCredential_replacedByCredentialId_fkey" FOREIGN KEY ("replacedByCredentialId") REFERENCES "ExternalProviderCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

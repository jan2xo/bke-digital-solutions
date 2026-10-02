CREATE TABLE "LicensingAgentUpdateKey" (
  "id" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL DEFAULT 'Ed25519',
  "publicKey" TEXT NOT NULL,
  "privateKeyReference" TEXT NOT NULL,
  "trustedFromVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'STAGED',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),

  CONSTRAINT "LicensingAgentUpdateKey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LicensingAgentUpdateKey_algorithm_check" CHECK ("algorithm" = 'Ed25519'),
  CONSTRAINT "LicensingAgentUpdateKey_status_check" CHECK ("status" IN ('STAGED', 'ACTIVE', 'RETIRED')),
  CONSTRAINT "LicensingAgentUpdateKey_private_reference_check"
    CHECK ("privateKeyReference" ~ '^key:[A-Za-z0-9._-]{1,64}$')
);

CREATE UNIQUE INDEX "LicensingAgentUpdateKey_keyId_key"
  ON "LicensingAgentUpdateKey"("keyId");
CREATE INDEX "LicensingAgentUpdateKey_status_idx"
  ON "LicensingAgentUpdateKey"("status");

CREATE TABLE "LicensingAgentUpdateRelease" (
  "id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "minimumSupportedVersion" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "audience" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'stable',
  "releaseTag" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT,
  "activatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),

  CONSTRAINT "LicensingAgentUpdateRelease_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LicensingAgentUpdateRelease_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "LicensingAgentUpdateRelease_audience_check" CHECK ("audience" IN ('PREPRODUCTION', 'PRODUCTION')),
  CONSTRAINT "LicensingAgentUpdateRelease_channel_check" CHECK ("channel" = 'stable')
);

CREATE UNIQUE INDEX "LicensingAgentUpdateRelease_version_audience_key"
  ON "LicensingAgentUpdateRelease"("version", "audience");
CREATE UNIQUE INDEX "LicensingAgentUpdateRelease_revision_audience_key"
  ON "LicensingAgentUpdateRelease"("revision", "audience");
CREATE UNIQUE INDEX "LicensingAgentUpdateRelease_releaseTag_audience_key"
  ON "LicensingAgentUpdateRelease"("releaseTag", "audience");
CREATE UNIQUE INDEX "LicensingAgentUpdateRelease_one_active_audience"
  ON "LicensingAgentUpdateRelease"("audience")
  WHERE "active" = true;
CREATE INDEX "LicensingAgentUpdateRelease_audience_active_idx"
  ON "LicensingAgentUpdateRelease"("audience", "active");

CREATE TABLE "LicensingAgentUpdateArtifact" (
  "id" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "architecture" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "contentType" TEXT NOT NULL DEFAULT 'application/vnd.microsoft.portable-executable',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LicensingAgentUpdateArtifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LicensingAgentUpdateArtifact_architecture_check" CHECK ("architecture" IN ('x86_64', 'arm64')),
  CONSTRAINT "LicensingAgentUpdateArtifact_size_check" CHECK ("sizeBytes" > 1),
  CONSTRAINT "LicensingAgentUpdateArtifact_releaseId_fkey"
    FOREIGN KEY ("releaseId")
    REFERENCES "LicensingAgentUpdateRelease"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LicensingAgentUpdateArtifact_releaseId_architecture_key"
  ON "LicensingAgentUpdateArtifact"("releaseId", "architecture");
CREATE UNIQUE INDEX "LicensingAgentUpdateArtifact_releaseId_artifactId_key"
  ON "LicensingAgentUpdateArtifact"("releaseId", "artifactId");

CREATE TABLE "LicensingAgentUpdateOperation" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "actorId" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "LicensingAgentUpdateOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LicensingAgentUpdateOperation_status_check" CHECK ("status" IN ('COMPLETED', 'FAILED'))
);

CREATE UNIQUE INDEX "LicensingAgentUpdateOperation_operationId_key"
  ON "LicensingAgentUpdateOperation"("operationId");
CREATE INDEX "LicensingAgentUpdateOperation_action_createdAt_idx"
  ON "LicensingAgentUpdateOperation"("action", "createdAt");

-- V3 Agent account-session foundation.
-- Feature remains disabled until the Agent secure-store and server/Agent protocol are jointly certified.

CREATE TABLE "AgentDeviceAuthorization" (
  "id" TEXT NOT NULL,
  "deviceCodeHash" TEXT NOT NULL,
  "userCodeHash" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "deviceName" TEXT,
  "platform" TEXT NOT NULL,
  "architecture" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "pollIntervalSeconds" INTEGER NOT NULL,
  "lastPollAt" TIMESTAMP(3),
  "approvedByUserId" TEXT,
  "approvedAccountId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "deniedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "handoffExpiresAt" TIMESTAMP(3),
  "sessionId" TEXT,
  "tokenBundleCiphertext" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentDeviceAuthorization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentDeviceAuthorization_status_check"
    CHECK ("status" IN ('PENDING','APPROVED','DENIED','EXPIRED','CONSUMED')),
  CONSTRAINT "AgentDeviceAuthorization_poll_interval_check"
    CHECK ("pollIntervalSeconds" BETWEEN 2 AND 60),
  CONSTRAINT "AgentDeviceAuthorization_pending_shape_check"
    CHECK (
      "status" <> 'PENDING'
      OR (
        "approvedByUserId" IS NULL AND
        "approvedAccountId" IS NULL AND
        "approvedAt" IS NULL AND
        "deniedAt" IS NULL AND
        "consumedAt" IS NULL AND
        "sessionId" IS NULL
      )
    ),
  CONSTRAINT "AgentDeviceAuthorization_approved_shape_check"
    CHECK (
      "status" NOT IN ('APPROVED','CONSUMED')
      OR (
        "approvedByUserId" IS NOT NULL AND
        "approvedAccountId" IS NOT NULL AND
        "approvedAt" IS NOT NULL
      )
    ),
  CONSTRAINT "AgentDeviceAuthorization_denied_shape_check"
    CHECK ("status" <> 'DENIED' OR "deniedAt" IS NOT NULL),
  CONSTRAINT "AgentDeviceAuthorization_consumed_shape_check"
    CHECK (
      "status" <> 'CONSUMED'
      OR (
        "consumedAt" IS NOT NULL AND
        "handoffExpiresAt" IS NOT NULL AND
        "sessionId" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "AgentDeviceAuthorization_deviceCodeHash_key"
  ON "AgentDeviceAuthorization"("deviceCodeHash");
CREATE UNIQUE INDEX "AgentDeviceAuthorization_userCodeHash_key"
  ON "AgentDeviceAuthorization"("userCodeHash");
CREATE UNIQUE INDEX "AgentDeviceAuthorization_sessionId_key"
  ON "AgentDeviceAuthorization"("sessionId");
CREATE INDEX "AgentDeviceAuthorization_status_expiresAt_idx"
  ON "AgentDeviceAuthorization"("status","expiresAt");
CREATE INDEX "AgentDeviceAuthorization_approvedAccountId_status_idx"
  ON "AgentDeviceAuthorization"("approvedAccountId","status");
CREATE INDEX "AgentDeviceAuthorization_deviceId_status_idx"
  ON "AgentDeviceAuthorization"("deviceId","status");

ALTER TABLE "AgentDeviceAuthorization"
  ADD CONSTRAINT "AgentDeviceAuthorization_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentDeviceAuthorization"
  ADD CONSTRAINT "AgentDeviceAuthorization_approvedAccountId_fkey"
  FOREIGN KEY ("approvedAccountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AgentAccountSession" (
  "id" TEXT NOT NULL,
  "deviceAuthorizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "accessTokenHash" TEXT NOT NULL,
  "accessExpiresAt" TIMESTAMP(3) NOT NULL,
  "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
  "refreshGeneration" INTEGER NOT NULL DEFAULT 0,
  "revokedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentAccountSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentAccountSession_refresh_generation_check" CHECK ("refreshGeneration" >= 0),
  CONSTRAINT "AgentAccountSession_expiry_check" CHECK ("refreshExpiresAt" > "accessExpiresAt")
);

CREATE UNIQUE INDEX "AgentAccountSession_deviceAuthorizationId_key"
  ON "AgentAccountSession"("deviceAuthorizationId");
CREATE UNIQUE INDEX "AgentAccountSession_accessTokenHash_key"
  ON "AgentAccountSession"("accessTokenHash");
CREATE INDEX "AgentAccountSession_userId_revokedAt_idx"
  ON "AgentAccountSession"("userId","revokedAt");
CREATE INDEX "AgentAccountSession_accountId_revokedAt_idx"
  ON "AgentAccountSession"("accountId","revokedAt");
CREATE INDEX "AgentAccountSession_deviceId_revokedAt_idx"
  ON "AgentAccountSession"("deviceId","revokedAt");
CREATE INDEX "AgentAccountSession_refreshExpiresAt_revokedAt_idx"
  ON "AgentAccountSession"("refreshExpiresAt","revokedAt");

ALTER TABLE "AgentAccountSession"
  ADD CONSTRAINT "AgentAccountSession_deviceAuthorizationId_fkey"
  FOREIGN KEY ("deviceAuthorizationId") REFERENCES "AgentDeviceAuthorization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentAccountSession"
  ADD CONSTRAINT "AgentAccountSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentAccountSession"
  ADD CONSTRAINT "AgentAccountSession_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE TABLE "AgentAccountRefreshToken" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "rotatedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentAccountRefreshToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentAccountRefreshToken_generation_check" CHECK ("generation" >= 0),
  CONSTRAINT "AgentAccountRefreshToken_status_check"
    CHECK ("status" IN ('ACTIVE','ROTATED','REVOKED')),
  CONSTRAINT "AgentAccountRefreshToken_rotated_shape_check"
    CHECK ("status" <> 'ROTATED' OR "rotatedAt" IS NOT NULL),
  CONSTRAINT "AgentAccountRefreshToken_revoked_shape_check"
    CHECK ("status" <> 'REVOKED' OR "revokedAt" IS NOT NULL)
);

CREATE UNIQUE INDEX "AgentAccountRefreshToken_tokenHash_key"
  ON "AgentAccountRefreshToken"("tokenHash");
CREATE UNIQUE INDEX "AgentAccountRefreshToken_sessionId_generation_key"
  ON "AgentAccountRefreshToken"("sessionId","generation");
CREATE INDEX "AgentAccountRefreshToken_sessionId_status_idx"
  ON "AgentAccountRefreshToken"("sessionId","status");
CREATE INDEX "AgentAccountRefreshToken_expiresAt_status_idx"
  ON "AgentAccountRefreshToken"("expiresAt","status");

ALTER TABLE "AgentAccountRefreshToken"
  ADD CONSTRAINT "AgentAccountRefreshToken_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "AgentAccountSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

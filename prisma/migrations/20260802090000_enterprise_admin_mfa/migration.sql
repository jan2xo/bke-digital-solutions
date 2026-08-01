CREATE TYPE "MfaChallengePurpose" AS ENUM ('LOGIN');
CREATE TYPE "SecurityEventType" AS ENUM ('ADMIN_PASSWORD_ACCEPTED','MFA_CHALLENGE_SUCCEEDED','MFA_CHALLENGE_FAILED','MFA_ENROLLED','MFA_DISABLED','MFA_RECOVERY_USED','MFA_RECOVERY_REGENERATED','RECENT_AUTH_SUCCEEDED','RECENT_AUTH_FAILED','ADMIN_SESSION_REVOKED','ADMIN_MAGIC_LOGIN_BLOCKED');

ALTER TABLE "Session" ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3), ADD COLUMN "recentAuthenticatedAt" TIMESTAMP(3), ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "absoluteExpiresAt" TIMESTAMP(3);
UPDATE "Session" SET "absoluteExpiresAt" = "expiresAt";
ALTER TABLE "Session" ALTER COLUMN "absoluteExpiresAt" SET NOT NULL;

CREATE TABLE "AdministratorMfaMethod" ("id" TEXT NOT NULL,"userId" TEXT NOT NULL,"encryptedSecret" TEXT NOT NULL,"keyVersion" INTEGER NOT NULL DEFAULT 1,"pendingExpiresAt" TIMESTAMP(3),"enabledAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "AdministratorMfaMethod_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "AdministratorMfaMethod_userId_key" ON "AdministratorMfaMethod"("userId");
ALTER TABLE "AdministratorMfaMethod" ADD CONSTRAINT "AdministratorMfaMethod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AdministratorRecoveryCode" ("id" TEXT NOT NULL,"userId" TEXT NOT NULL,"codeHash" TEXT NOT NULL,"usedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "AdministratorRecoveryCode_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "AdministratorRecoveryCode_codeHash_key" ON "AdministratorRecoveryCode"("codeHash");
CREATE INDEX "AdministratorRecoveryCode_userId_usedAt_idx" ON "AdministratorRecoveryCode"("userId","usedAt");
ALTER TABLE "AdministratorRecoveryCode" ADD CONSTRAINT "AdministratorRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MfaChallenge" ("id" TEXT NOT NULL,"userId" TEXT NOT NULL,"purpose" "MfaChallengePurpose" NOT NULL DEFAULT 'LOGIN',"tokenHash" TEXT NOT NULL,"expiresAt" TIMESTAMP(3) NOT NULL,"consumedAt" TIMESTAMP(3),"attemptCount" INTEGER NOT NULL DEFAULT 0,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "MfaChallenge_pkey" PRIMARY KEY ("id"),CONSTRAINT "MfaChallenge_attempts_check" CHECK ("attemptCount" >= 0 AND "attemptCount" <= 5));
CREATE UNIQUE INDEX "MfaChallenge_tokenHash_key" ON "MfaChallenge"("tokenHash");
CREATE INDEX "MfaChallenge_userId_expiresAt_idx" ON "MfaChallenge"("userId","expiresAt");
ALTER TABLE "MfaChallenge" ADD CONSTRAINT "MfaChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SecurityEvent" ("id" TEXT NOT NULL,"userId" TEXT,"type" "SecurityEventType" NOT NULL,"ipHint" TEXT,"userAgentHint" TEXT,"metadata" JSONB,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id"));
CREATE INDEX "SecurityEvent_userId_createdAt_idx" ON "SecurityEvent"("userId","createdAt");
CREATE INDEX "SecurityEvent_type_createdAt_idx" ON "SecurityEvent"("type","createdAt");
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

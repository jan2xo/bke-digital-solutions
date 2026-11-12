-- Agent machine-key possession authority (source-only).
-- Private keys never enter Digital Solutions. Registration and one-time
-- challenge state are bound to an authenticated AgentAccountSession.
-- No live endpoint or production mutation is authorized by this migration.
CREATE TABLE "AgentLeaseKeyRegistration" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "publicKeyPem" TEXT NOT NULL,
  "keyThumbprint" TEXT NOT NULL,
  "keyAlgorithm" TEXT NOT NULL,
  "keyProtection" TEXT NOT NULL DEFAULT 'software',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "validUntil" TIMESTAMP(3) NOT NULL,
  "activatedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentLeaseKeyRegistration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentLeaseKeyRegistration_protection_check" CHECK ("keyProtection" = 'software'),
  CONSTRAINT "AgentLeaseKeyRegistration_algorithm_check" CHECK ("keyAlgorithm" IN ('EdDSA', 'ES256')),
  CONSTRAINT "AgentLeaseKeyRegistration_status_check" CHECK ("status" IN ('PENDING','ACTIVE','REVOKED')),
  CONSTRAINT "AgentLeaseKeyRegistration_active_shape_check" CHECK ("status" <> 'ACTIVE' OR ("activatedAt" IS NOT NULL AND "revokedAt" IS NULL)),
  CONSTRAINT "AgentLeaseKeyRegistration_revoked_shape_check" CHECK ("status" <> 'REVOKED' OR "revokedAt" IS NOT NULL),
  CONSTRAINT "AgentLeaseKeyRegistration_lifetime_check" CHECK ("validUntil" > "createdAt"),
  CONSTRAINT "AgentLeaseKeyRegistration_thumbprint_check" CHECK ("keyThumbprint" ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT "AgentLeaseKeyRegistration_session_fk" FOREIGN KEY ("sessionId") REFERENCES "AgentAccountSession"("id") ON DELETE RESTRICT,
  CONSTRAINT "AgentLeaseKeyRegistration_account_fk" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT,
  CONSTRAINT "AgentLeaseKeyRegistration_user_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "AgentLeaseKeyRegistration_one_active_session"
  ON "AgentLeaseKeyRegistration"("sessionId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "AgentLeaseKeyRegistration_one_pending_session"
  ON "AgentLeaseKeyRegistration"("sessionId") WHERE "status" = 'PENDING';
CREATE INDEX "AgentLeaseKeyRegistration_session_status"
  ON "AgentLeaseKeyRegistration"("sessionId", "status");

CREATE TABLE "AgentLeaseKeyChallenge" (
  "id" TEXT NOT NULL,
  "registrationId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "productId" TEXT,
  "action" TEXT,
  "messageHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentLeaseKeyChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentLeaseKeyChallenge_registration_fk" FOREIGN KEY ("registrationId") REFERENCES "AgentLeaseKeyRegistration"("id") ON DELETE RESTRICT,
  CONSTRAINT "AgentLeaseKeyChallenge_session_fk" FOREIGN KEY ("sessionId") REFERENCES "AgentAccountSession"("id") ON DELETE RESTRICT,
  CONSTRAINT "AgentLeaseKeyChallenge_purpose_check" CHECK ("purpose" IN ('ENROLL','LEASE')),
  CONSTRAINT "AgentLeaseKeyChallenge_scope_check" CHECK (
    ("purpose" = 'ENROLL' AND "productId" IS NULL AND "action" IS NULL) OR
    ("purpose" = 'LEASE' AND "productId" IS NOT NULL AND "action" IN ('OPEN','USE'))
  ),
  CONSTRAINT "AgentLeaseKeyChallenge_hash_check" CHECK ("messageHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AgentLeaseKeyChallenge_verification_check" CHECK ("verifiedAt" IS NULL OR "consumedAt" IS NOT NULL),
  CONSTRAINT "AgentLeaseKeyChallenge_expiry_check" CHECK ("expiresAt" > "createdAt")
);
CREATE UNIQUE INDEX "AgentLeaseKeyChallenge_messageHash_key"
  ON "AgentLeaseKeyChallenge"("messageHash");
CREATE INDEX "AgentLeaseKeyChallenge_registration_expiry"
  ON "AgentLeaseKeyChallenge"("registrationId","expiresAt");
CREATE INDEX "AgentLeaseKeyChallenge_session_unspent"
  ON "AgentLeaseKeyChallenge"("sessionId","consumedAt","expiresAt");

-- SOURCE/PREPRODUCTION ONLY. NEVER APPLY TO PRODUCTION WITHOUT AUTHORIZATION.
-- Agent machine/privileged installer attestation trust is independent of
-- customer account authorization and of DS's own signing private key.
-- This registry stores PUBLIC keys only; enrollment/activation is not in this wave.
CREATE TABLE "AgentStartupAttestationSigningKey" (
  "kid" TEXT PRIMARY KEY,
  "deviceId" TEXT NOT NULL,
  "publicKeyPem" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'STAGED',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "activatedAt" TIMESTAMPTZ,
  "revokedAt" TIMESTAMPTZ,
  CONSTRAINT "AgentStartupAttestationSigningKey_kid"
    CHECK ("kid" ~ '^[A-Za-z0-9._-]{1,128}$'),
  CONSTRAINT "AgentStartupAttestationSigningKey_device"
    CHECK (length("deviceId") BETWEEN 16 AND 128),
  CONSTRAINT "AgentStartupAttestationSigningKey_status"
    CHECK ("status" IN ('STAGED','ACTIVE','REVOKED')),
  CONSTRAINT "AgentStartupAttestationSigningKey_timestamps"
    CHECK (
      ("status" <> 'ACTIVE' OR "activatedAt" IS NOT NULL)
      AND ("status" <> 'REVOKED' OR "revokedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "AgentStartupAttestationSigningKey_one_active_device"
  ON "AgentStartupAttestationSigningKey" ("deviceId")
  WHERE "status"='ACTIVE';

CREATE FUNCTION "agent_startup_attestation_trust_immutable"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."kid" <> OLD."kid" OR NEW."deviceId" <> OLD."deviceId"
     OR NEW."publicKeyPem" <> OLD."publicKeyPem" THEN
    RAISE EXCEPTION 'AGENT_STARTUP_ATTESTATION_KEY_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD."status"='REVOKED' AND NEW."status"<>'REVOKED' THEN
    RAISE EXCEPTION 'AGENT_STARTUP_ATTESTATION_KEY_REVOKED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AgentStartupAttestationSigningKey_immutable"
BEFORE UPDATE ON "AgentStartupAttestationSigningKey"
FOR EACH ROW EXECUTE FUNCTION "agent_startup_attestation_trust_immutable"();

-- Exactly-once attestation consumption must commit atomically with the signed
-- DS startup policy audit or roll back both. No bearer, PEM or signed payload
-- is stored here.
CREATE TABLE "AgentStartupAttestationReceipt" (
  "attestationId" UUID PRIMARY KEY,
  "signerKid" TEXT NOT NULL
    REFERENCES "AgentStartupAttestationSigningKey"("kid") ON DELETE RESTRICT,
  "productId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "installationId" UUID NOT NULL,
  "imageSha256" CHAR(64) NOT NULL,
  "attestationSha256" CHAR(64) NOT NULL,
  "consumedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "AgentStartupAttestationReceipt_digest"
    CHECK ("imageSha256" ~ '^[0-9a-f]{64}$' AND
           "attestationSha256" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "AgentStartupAttestationReceipt_product"
  ON "AgentStartupAttestationReceipt" ("productId", "consumedAt");

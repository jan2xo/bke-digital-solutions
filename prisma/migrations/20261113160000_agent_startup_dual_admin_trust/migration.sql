-- PREPRODUCTION ONLY; disposable CI migration. No production mutation.
-- The existing issuer trusts ACTIVE public keys; no candidate may directly
-- insert ACTIVE or approve its own machine signing key.
ALTER TABLE "AgentStartupAttestationSigningKey"
  ADD COLUMN "stagedBy" TEXT REFERENCES "User"("id") ON DELETE RESTRICT,
  ADD COLUMN "activatedBy" TEXT REFERENCES "User"("id") ON DELETE RESTRICT,
  ADD COLUMN "revokedBy" TEXT REFERENCES "User"("id") ON DELETE RESTRICT,
  ADD COLUMN "publicKeySha256" CHAR(64),
  ADD COLUMN "activationProofSha256" CHAR(64),
  ADD COLUMN "reviewedAt" TIMESTAMPTZ;

-- Existing preproduction ACTIVE keys lack independent review evidence.
-- Quarantine before installing the new transition guard. Original immutable
-- trigger already permits ACTIVE -> REVOKED and forbids reverse transition.
UPDATE "AgentStartupAttestationSigningKey"
   SET "status" = 'REVOKED', "revokedAt" = now()
 WHERE "status" = 'ACTIVE';

CREATE FUNCTION "agent_startup_key_dual_admin_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'STAGED' OR NEW."stagedBy" IS NULL OR
       NEW."publicKeySha256" IS NULL OR
       NEW."publicKeySha256" !~ '^[0-9a-f]{64}$' OR
       NEW."activatedBy" IS NOT NULL OR
       NEW."activationProofSha256" IS NOT NULL OR
       NEW."revokedBy" IS NOT NULL OR
       NEW."activatedAt" IS NOT NULL OR NEW."revokedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'AGENT_STARTUP_KEY_REQUIRES_STAGED_ADMIN';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."stagedBy" IS DISTINCT FROM OLD."stagedBy" OR
     NEW."publicKeySha256" IS DISTINCT FROM OLD."publicKeySha256" THEN
    RAISE EXCEPTION 'AGENT_STARTUP_KEY_STAGING_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD."status" = 'STAGED' AND NEW."status" = 'ACTIVE' THEN
    IF OLD."stagedBy" IS NULL OR NEW."activatedBy" IS NULL OR
       NEW."activatedBy" = OLD."stagedBy" OR NEW."activatedAt" IS NULL OR
       NEW."reviewedAt" IS NULL OR NEW."activationProofSha256" IS NULL OR
       NEW."activationProofSha256" !~ '^[0-9a-f]{64}$' OR
       NEW."revokedBy" IS NOT NULL OR NEW."revokedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'AGENT_STARTUP_KEY_SECOND_ADMIN_PROOF_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" IN ('STAGED','ACTIVE') AND NEW."status" = 'REVOKED' THEN
    IF NEW."revokedAt" IS NULL OR NEW."revokedBy" IS NULL OR
       NEW."activatedBy" IS DISTINCT FROM OLD."activatedBy" OR
       NEW."activationProofSha256" IS DISTINCT FROM OLD."activationProofSha256" OR
       NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt" OR
       NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" THEN
      RAISE EXCEPTION 'AGENT_STARTUP_KEY_REVOCATION_AUDIT_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'AGENT_STARTUP_KEY_ILLEGAL_STATE_TRANSITION';
  END IF;
  IF NEW."activatedBy" IS DISTINCT FROM OLD."activatedBy" OR
     NEW."activationProofSha256" IS DISTINCT FROM OLD."activationProofSha256" OR
     NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt" OR
     NEW."revokedBy" IS DISTINCT FROM OLD."revokedBy" OR
     NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" OR
     NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
    RAISE EXCEPTION 'AGENT_STARTUP_KEY_APPROVAL_AUDIT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AgentStartupAttestationSigningKey_dual_admin"
BEFORE INSERT OR UPDATE ON "AgentStartupAttestationSigningKey"
FOR EACH ROW EXECUTE FUNCTION "agent_startup_key_dual_admin_guard"();

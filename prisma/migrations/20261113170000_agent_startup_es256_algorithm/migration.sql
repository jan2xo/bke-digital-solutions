-- Source-only PREPRODUCTION algorithm-explicit startup machine key registry.
-- Preserve existing Ed25519 v1 rows and dual-admin lifecycle unchanged.
-- NEVER apply to production without independent authorization.
ALTER TABLE "AgentStartupAttestationSigningKey"
  ADD COLUMN "algorithm" TEXT NOT NULL DEFAULT 'Ed25519',
  ADD CONSTRAINT "AgentStartupAttestationSigningKey_algorithm"
    CHECK ("algorithm" IN ('Ed25519', 'ES256'));

-- Existing immutable key+device+PEM guard remains active. Algorithm is also
-- immutable: no Ed25519 -> ES256 or ES256 -> Ed25519 upgrade/downgrade in place.
CREATE FUNCTION "agent_startup_machine_algorithm_immutable"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."algorithm" IS DISTINCT FROM OLD."algorithm" THEN
    RAISE EXCEPTION 'AGENT_STARTUP_KEY_ALGORITHM_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AgentStartupAttestationSigningKey_algorithm_immutable"
BEFORE UPDATE ON "AgentStartupAttestationSigningKey"
FOR EACH ROW EXECUTE FUNCTION "agent_startup_machine_algorithm_immutable"();

-- NO automatic ES256 activation or import, NO hardware-assurance flag and
-- NO change to active Ed25519 v1 issuer or signing key custody.

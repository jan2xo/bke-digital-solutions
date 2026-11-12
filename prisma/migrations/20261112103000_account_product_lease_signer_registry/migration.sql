-- SOURCE/PREPRODUCTION ONLY: no production DB mutation is authorized.
-- Private signer bytes NEVER enter this table. Separate from commercial keys.
CREATE TABLE "AccountProductLeaseSigningKey" (
  "kid" TEXT PRIMARY KEY,
  "publicKeyPem" TEXT NOT NULL,
  "privateKeyReference" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'STAGED',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "activatedAt" TIMESTAMPTZ,
  "verifyOnlyAt" TIMESTAMPTZ,
  "revokedAt" TIMESTAMPTZ,
  CONSTRAINT "AccountProductLeaseSigningKey_kid_valid"
    CHECK ("kid" ~ '^[A-Za-z0-9._-]{1,128}$'),
  CONSTRAINT "AccountProductLeaseSigningKey_reference_valid"
    CHECK ("privateKeyReference" = ('keyset:' || "kid")),
  CONSTRAINT "AccountProductLeaseSigningKey_status_valid"
    CHECK ("status" IN ('STAGED','ACTIVE','VERIFY_ONLY','REVOKED')),
  CONSTRAINT "AccountProductLeaseSigningKey_transition_timestamps"
    CHECK (
      ("status" <> 'ACTIVE' OR "activatedAt" IS NOT NULL)
      AND ("status" <> 'VERIFY_ONLY' OR ("activatedAt" IS NOT NULL AND "verifyOnlyAt" IS NOT NULL))
      AND ("status" <> 'REVOKED' OR "revokedAt" IS NOT NULL)
    )
);
CREATE UNIQUE INDEX "AccountProductLeaseSigningKey_one_active"
  ON "AccountProductLeaseSigningKey" ("status") WHERE "status" = 'ACTIVE';

-- Terminal revocation cannot be undone even by an unsafe SQL update.
CREATE FUNCTION "account_product_signing_key_immutable_revocation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'REVOKED' AND
     (NEW."status" <> 'REVOKED' OR NEW."publicKeyPem" <> OLD."publicKeyPem"
       OR NEW."privateKeyReference" <> OLD."privateKeyReference") THEN
    RAISE EXCEPTION 'ACCOUNT_PRODUCT_SIGNING_KEY_REVOKED';
  END IF;
  IF OLD."publicKeyPem" <> NEW."publicKeyPem" OR
     OLD."privateKeyReference" <> NEW."privateKeyReference" OR
     OLD."kid" <> NEW."kid" THEN
    RAISE EXCEPTION 'ACCOUNT_PRODUCT_SIGNING_KEY_IDENTITY_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AccountProductLeaseSigningKey_immutable"
BEFORE UPDATE ON "AccountProductLeaseSigningKey"
FOR EACH ROW EXECUTE FUNCTION "account_product_signing_key_immutable_revocation"();

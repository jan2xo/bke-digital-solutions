-- SQL-owned ProductActivationPolicy, following the established Agent-trust
-- pattern for narrowly scoped server-owned tables outside Prisma models.
-- Existing products are backfilled to EITHER; future Product inserts receive
-- an EITHER row in the same DB transaction. Missing policy must DENY, never
-- silently widen ACCOUNT-only or LICENSE_KEY-only software to EITHER.
-- Source-only migration: production must not apply without explicit approval.
CREATE TABLE "ProductActivationPolicy" (
  "productId" TEXT PRIMARY KEY
    REFERENCES "Product"("id") ON DELETE CASCADE,
  "activationMode" TEXT NOT NULL,
  CONSTRAINT "ProductActivationPolicy_mode_supported_check"
    CHECK ("activationMode" IN ('ACCOUNT', 'LICENSE_KEY', 'EITHER'))
);

INSERT INTO "ProductActivationPolicy" ("productId", "activationMode")
SELECT p."id", 'EITHER' FROM "Product" p;

CREATE FUNCTION "initialize_product_activation_policy"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "ProductActivationPolicy" ("productId", "activationMode")
  VALUES (NEW."id", 'EITHER');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProductActivationPolicy_default_on_create"
AFTER INSERT ON "Product"
FOR EACH ROW EXECUTE FUNCTION "initialize_product_activation_policy"();

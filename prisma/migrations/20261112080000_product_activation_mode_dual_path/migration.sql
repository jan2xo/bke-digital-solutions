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
  "publishedEver" BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT "ProductActivationPolicy_mode_supported_check"
    CHECK ("activationMode" IN ('ACCOUNT', 'LICENSE_KEY', 'EITHER'))
);

-- Preserve history even for a product later unpublished or archived.
INSERT INTO "ProductActivationPolicy" ("productId", "activationMode", "publishedEver")
SELECT p."id", 'EITHER',
       (p."active" OR p."publishedAt" IS NOT NULL OR EXISTS (
         SELECT 1 FROM "AuditLog" a
          WHERE a."targetType" = 'Product' AND a."targetId" = p."id"
            AND a."action" IN ('PRODUCT_PUBLISH', 'PRODUCT_UNPUBLISH', 'PRODUCT_ARCHIVE')
       ))
  FROM "Product" p;

CREATE FUNCTION "initialize_product_activation_policy"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "ProductActivationPolicy" ("productId", "activationMode", "publishedEver")
  VALUES (NEW."id", 'EITHER',
    (NEW."active" OR NEW."publishedAt" IS NOT NULL));
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProductActivationPolicy_default_on_create"
AFTER INSERT ON "Product"
FOR EACH ROW EXECUTE FUNCTION "initialize_product_activation_policy"();

-- Mark publication durably regardless of whether the update comes through
-- the admin route, and never reset it on UNPUBLISH or ARCHIVE.
CREATE FUNCTION "remember_product_activation_published"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."active" OR NEW."publishedAt" IS NOT NULL THEN
    UPDATE "ProductActivationPolicy"
       SET "publishedEver" = TRUE
     WHERE "productId" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProductActivationPolicy_mark_published"
AFTER UPDATE OF "active", "publishedAt" ON "Product"
FOR EACH ROW EXECUTE FUNCTION "remember_product_activation_published"();

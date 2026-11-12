-- SQL-owned ProductActivationPolicy, following the established Agent-trust
-- pattern for narrowly scoped server-owned tables outside Prisma models.
-- Existing products have no row and resolve to EITHER (backward compatible).
-- Source-only migration: production must not apply without explicit approval.
CREATE TABLE "ProductActivationPolicy" (
  "productId" TEXT PRIMARY KEY
    REFERENCES "Product"("id") ON DELETE CASCADE,
  "activationMode" TEXT NOT NULL,
  CONSTRAINT "ProductActivationPolicy_mode_supported_check"
    CHECK ("activationMode" IN ('ACCOUNT', 'LICENSE_KEY', 'EITHER'))
);

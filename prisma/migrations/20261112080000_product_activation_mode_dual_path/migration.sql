-- Additive, source-only schema migration. Existing products MUST retain both
-- account-backed and commercial license-key activation by default.
-- This migration must never be applied to production without separate approval.
ALTER TABLE "Product"
  ADD COLUMN "activationMode" TEXT NOT NULL DEFAULT 'EITHER';

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_activationMode_supported_check"
  CHECK ("activationMode" IN ('ACCOUNT', 'LICENSE_KEY', 'EITHER'));

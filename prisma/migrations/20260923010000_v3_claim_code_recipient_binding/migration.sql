-- Bind claimable purchases to an intended verified recipient without
-- turning the email address into permanent entitlement ownership authority.
-- Null remains valid for legacy/unbound gift and migration claim codes.

ALTER TABLE "ClaimCode"
  ADD COLUMN "recipientEmail" TEXT;

ALTER TABLE "ClaimCode"
  ADD CONSTRAINT "ClaimCode_recipientEmail_shape_check"
  CHECK (
    "recipientEmail" IS NULL
    OR (
      char_length("recipientEmail") BETWEEN 3 AND 254
      AND "recipientEmail" = lower("recipientEmail")
      AND position('@' in "recipientEmail") > 1
    )
  );

CREATE INDEX "ClaimCode_recipientEmail_status_idx"
  ON "ClaimCode"("recipientEmail", "status");

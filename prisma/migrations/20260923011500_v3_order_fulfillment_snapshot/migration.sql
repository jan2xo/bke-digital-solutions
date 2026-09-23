-- Persist opaque host-owned fulfillment context for claim-aware Commerce 0.14.0.
-- The earlier V3 claim-code migration already owns CommerceFulfillmentMode / Order.fulfillmentMode.

ALTER TABLE "Order"
  ADD COLUMN "fulfillmentSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb;

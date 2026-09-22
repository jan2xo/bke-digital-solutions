-- Persist opaque Commerce fulfillment context atomically with the order.
-- Digital Solutions currently stores only recipient identity metadata here.
ALTER TABLE "Order"
  ADD COLUMN "fulfillmentSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb;

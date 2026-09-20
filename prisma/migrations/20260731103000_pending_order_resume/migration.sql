-- Store the provider-hosted checkout URL so an authorized customer can resume
-- a pending payment. This value is never logged or included in order reads.
ALTER TABLE "PaymentAttempt" ADD COLUMN "checkoutUrl" TEXT;

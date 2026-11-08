-- V3-host adaptation for the already-published @bke/commerce@0.15.0
-- The checkout-offer repository stores discountedBillingCycles on each redemption
-- as a historical pricing snapshot. V3's shared OfferRedemption table originally
-- omitted this nullable field, so checkout failed even without an offer.
-- NULL on pre-existing rows is deliberate: do not infer an historical snapshot
-- from the potentially updated DiscountOffer definition.
ALTER TABLE "OfferRedemption" ADD COLUMN "discountedBillingCycles" INTEGER;

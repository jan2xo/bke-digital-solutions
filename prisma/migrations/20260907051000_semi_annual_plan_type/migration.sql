-- Commit the enum addition before the following migration references it.
ALTER TYPE "PurchasePlanType" ADD VALUE IF NOT EXISTS 'SEMI_ANNUAL';

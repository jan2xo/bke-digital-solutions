-- Add enum value only; PostgreSQL may reject same-transaction use in constraints.
ALTER TYPE "PurchasePlanType" ADD VALUE IF NOT EXISTS 'SEMI_ANNUAL';

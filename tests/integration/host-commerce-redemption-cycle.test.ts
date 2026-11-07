import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../platform/host/generated/prisma/client";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

afterAll(async () => db.$disconnect());

describe("V3 host Commerce offer redemption cycle snapshot (disposable PostgreSQL)", () => {
  it("stores discounted cycles on the redemption, not only the mutable offer", async () => {
    const columns = await db.$queryRaw<Array<{
      table_name: string;
      column_name: string;
      is_nullable: string;
      data_type: string;
    }>>`
      SELECT table_name, column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('OfferRedemption', 'DiscountOffer')
        AND column_name = 'discountedBillingCycles'
      ORDER BY table_name
    `;
    expect(columns).toEqual([
      { table_name: "DiscountOffer", column_name: "discountedBillingCycles", is_nullable: "YES", data_type: "integer" },
      { table_name: "OfferRedemption", column_name: "discountedBillingCycles", is_nullable: "YES", data_type: "integer" },
    ]);

    // This is the exact failing SELECT shape in published @bke/commerce:
    // even when an order has no promotion it must be valid PostgreSQL.
    const result = await db.$queryRaw<Array<{
      redemptionId: string;
      discountedBillingCycles: number | null;
    }>>`
      SELECT r."id" AS "redemptionId", r."discountedBillingCycles"
      FROM "OfferRedemption" r
      JOIN "DiscountOffer" o ON o."id" = r."offerId"
      WHERE r."orderId" = 'nonexistent-v3-cycle-snapshot-test'
      LIMIT 1 FOR UPDATE OF r
    `;
    expect(result).toEqual([]);
  });
});

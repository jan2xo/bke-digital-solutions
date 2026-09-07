import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

describe.sequential("semi-annual zero-discount database terms", () => {
  afterAll(async () => { await db.$disconnect(); });

  it("allows an active six-month plan at 0% while keeping null as the unconfigured inactive state", async () => {
    const product = await db.product.create({
      data: {
        slug: `semi-zero-${randomUUID()}`,
        name: "Semi-annual zero discount fixture",
        summary: "Test",
        description: "Disposable integration fixture",
        type: "SAAS",
        active: true,
      },
    });
    const edition = await db.edition.create({
      data: {
        productId: product.id,
        name: "Standard",
        slug: "standard",
        features: [],
        maxUsers: 1,
        maxDevicesPerUser: 1,
        updatePolicy: "ACTIVE_TERM",
        active: true,
      },
    });
    const monthly = await db.purchasePlan.create({
      data: {
        editionId: edition.id,
        type: "MONTHLY",
        amountMinor: 10_000,
        renewalBehavior: "CUSTOMER_AUTHORIZED",
        active: true,
      },
    });

    const semiAnnual = await db.purchasePlan.create({
      data: {
        editionId: edition.id,
        type: "SEMI_ANNUAL",
        monthlySourcePlanId: monthly.id,
        semiAnnualDiscountBps: 0,
        renewalBehavior: "CUSTOMER_AUTHORIZED",
        active: true,
      },
    });
    expect(semiAnnual).toMatchObject({ active: true, semiAnnualDiscountBps: 0 });

    await db.purchasePlan.update({ where: { id: semiAnnual.id }, data: { active: false, semiAnnualDiscountBps: null } });
    await expect(db.purchasePlan.update({ where: { id: semiAnnual.id }, data: { active: true } })).rejects.toThrow();
    const reactivated = await db.purchasePlan.update({ where: { id: semiAnnual.id }, data: { active: true, semiAnnualDiscountBps: 0 } });
    expect(reactivated).toMatchObject({ active: true, semiAnnualDiscountBps: 0 });
  });
});

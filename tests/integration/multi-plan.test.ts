import "dotenv/config";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { checkoutSchema } from "../../lib/validation";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
let userId = "";
let accountId = "";

describe.sequential("edition and multi-plan commerce", () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const user = await db.user.create({ data: { email: `plans-${suffix}@bke.test`, name: "Plan Customer", emailVerified: new Date(), ownedAccounts: { create: { type: "INDIVIDUAL", displayName: "Plan Customer", billingEmail: `plans-${suffix}@bke.test` } } }, include: { ownedAccounts: true } });
    userId = user.id;
    accountId = user.ownedAccounts[0]!.id;
  });
  afterAll(() => db.$disconnect());

  it("accepts only a purchase plan identifier at the browser boundary", () => {
    expect(checkoutSchema.parse({ purchasePlanId: "cm00000000000000000000000" })).toEqual({ purchasePlanId: "cm00000000000000000000000" });
    expect(() => checkoutSchema.parse({ purchasePlanId: "cm00000000000000000000000", amountMinor: 1 })).toThrow();
    expect(() => checkoutSchema.parse({ priceId: "cm00000000000000000000000", quantity: 99 })).toThrow();
  });

  for (const type of ["PERPETUAL", "MONTHLY", "ANNUAL"] as const) {
    it(`issues the correct ${type.toLowerCase()} entitlement from server-owned terms`, async () => {
      const plan = await db.purchasePlan.findFirstOrThrow({ where: { edition: { product: { slug: "bke-institution-suite" } }, type, active: true }, include: { monthlySource: true, edition: true } });
      const { createCheckout } = await import("@/lib/checkout");
      const checkout = await createCheckout(userId, plan.id, accountId);
      const order = await db.order.findUniqueOrThrow({ where: { id: checkout.orderId }, include: { attempts: true, items: true } });
      expect(order.items[0]).toMatchObject({ purchasePlanId: plan.id, editionId: plan.editionId, planType: type, editionName: plan.edition.name });
      expect(order.items[0]!.unitAmountMinor).toBe(order.totalMinor);
      expect(order.items[0]!.entitlementSnapshot).toMatchObject({ maxUsers: plan.edition.maxUsers, maxDevicesPerUser: plan.edition.maxDevicesPerUser, updatePolicy: plan.edition.updatePolicy });

      const event = { eventId: `evt_plan_${type}_${order.id}`, type: "payment.paid", externalPaymentId: `pay_plan_${type}_${order.id}`, externalCheckoutId: order.attempts[0]!.externalCheckoutId, reference: order.number, amountMinor: order.totalMinor, currency: order.currency, livemode: false, occurredAt: new Date().toISOString() };
      const raw = Buffer.from(JSON.stringify(event));
      const signature = createHmac("sha256", process.env.SESSION_SECRET!).update(raw).digest("hex");
      const { processPaymentWebhook } = await import("@/lib/webhooks");
      await processPaymentWebhook(raw, new Headers({ "x-mock-signature": signature }));
      expect(await processPaymentWebhook(raw, new Headers({ "x-mock-signature": signature }))).toEqual({ duplicate: true });

      const paid = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { licenses: true, subscriptions: true } });
      expect(paid.licenses).toHaveLength(1);
      expect(paid.licenses[0]).toMatchObject({ editionId: plan.editionId, purchasePlanId: plan.id, maxSeats: plan.edition.maxUsers, maxDevicesPerSeat: plan.edition.maxDevicesPerUser });
      expect(paid.subscriptions).toHaveLength(type === "PERPETUAL" ? 0 : 1);
      expect(paid.licenses[0]!.expiresAt === null).toBe(type === "PERPETUAL");
      expect(await db.license.count({ where: { orderId: order.id } })).toBe(1);
    });
  }

  it("keeps legacy commerce snapshots linked to their original scalar identifiers", async () => {
    const legacy = await db.orderItem.findFirst({ where: { purchasePlanId: null, unitAmountMinor: { gt: 0 } } });
    if (!legacy) return;
    expect(legacy.priceId).toBeTruthy();
    expect(legacy.unitAmountMinor).toBeGreaterThan(0);
    expect(legacy.totalMinor).toBe(legacy.unitAmountMinor * legacy.quantity);
  });

  it("does not rewrite an existing order when its plan price changes", async () => {
    const plan = await db.purchasePlan.findFirstOrThrow({ where: { edition: { product: { slug: "bke-deskflow" } }, type: "PERPETUAL", active: true } });
    const { createCheckout } = await import("@/lib/checkout");
    const checkout = await createCheckout(userId, plan.id, accountId);
    const before = await db.order.findUniqueOrThrow({ where: { id: checkout.orderId }, include: { items: true } });
    await db.purchasePlan.update({ where: { id: plan.id }, data: { amountMinor: plan.amountMinor! + 100 } });
    try {
      const after = await db.order.findUniqueOrThrow({ where: { id: checkout.orderId }, include: { items: true } });
      expect(after.totalMinor).toBe(before.totalMinor);
      expect(after.items[0]!.unitAmountMinor).toBe(before.items[0]!.unitAmountMinor);
    } finally {
      await db.purchasePlan.update({ where: { id: plan.id }, data: { amountMinor: plan.amountMinor } });
    }
  });

  it("rejects inactive plans at the server boundary", async () => {
    const plan = await db.purchasePlan.findFirstOrThrow({ where: { edition: { product: { slug: "bke-deskflow" } }, type: "PERPETUAL", active: true } });
    await db.purchasePlan.update({ where: { id: plan.id }, data: { active: false } });
    try {
      const { createCheckout } = await import("@/lib/checkout");
      await expect(createCheckout(userId, plan.id, accountId)).rejects.toThrow("INVALID_PURCHASE_PLAN");
    } finally {
      await db.purchasePlan.update({ where: { id: plan.id }, data: { active: true } });
    }
  });
});

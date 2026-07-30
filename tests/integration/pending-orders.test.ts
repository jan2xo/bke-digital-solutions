import "dotenv/config";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
let userId = "";
let accountId = "";
let purchasePlanId = "";
let orderId = "";

describe.sequential("pending-order recovery", () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const user = await db.user.create({ data: { email: `pending-${suffix}@bke.test`, emailVerified: new Date(), ownedAccounts: { create: { type: "INDIVIDUAL", displayName: "Pending Customer", billingEmail: `pending-${suffix}@bke.test` } } }, include: { ownedAccounts: true } });
    userId = user.id;
    accountId = user.ownedAccounts[0]!.id;
    purchasePlanId = (await db.purchasePlan.findFirstOrThrow({ where: { edition: { product: { slug: "bke-cloudops" } }, type: "ANNUAL", active: true } })).id;
  });
  afterAll(() => db.$disconnect());

  it("stores the hosted checkout only on its server-side attempt", async () => {
    const { createCheckout } = await import("@/lib/checkout");
    const checkout = await createCheckout(userId, purchasePlanId, accountId);
    orderId = checkout.orderId;
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { attempts: true } });
    expect(order.status).toBe("PENDING");
    expect(order.attempts).toHaveLength(1);
    expect(order.attempts[0]).toMatchObject({ status: "PENDING", checkoutUrl: checkout.checkoutUrl });
  });

  it("honors one verified late payment after local cancellation", async () => {
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { attempts: true } });
    await db.$transaction([
      db.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } }),
      db.paymentAttempt.updateMany({ where: { orderId: order.id }, data: { status: "CANCELLED" } }),
    ]);
    const event = { eventId: `evt_pending_late_${order.id}`, type: "payment.paid", externalPaymentId: `pay_pending_late_${order.id}`, externalCheckoutId: order.attempts[0]!.externalCheckoutId, reference: order.number, amountMinor: order.totalMinor, currency: order.currency, livemode: false, occurredAt: new Date().toISOString() };
    const raw = Buffer.from(JSON.stringify(event));
    const signature = createHmac("sha256", process.env.SESSION_SECRET!).update(raw).digest("hex");
    const { processPaymentWebhook } = await import("@/lib/webhooks");
    expect(await processPaymentWebhook(raw, new Headers({ "x-mock-signature": signature }))).toEqual({ processed: true });
    expect(await processPaymentWebhook(raw, new Headers({ "x-mock-signature": signature }))).toEqual({ duplicate: true });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1);
    expect(await db.license.count({ where: { orderId: order.id } })).toBe(1);
  });
});

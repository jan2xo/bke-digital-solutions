import "dotenv/config";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
let adminId = "";
let userId = "";
let accountId = "";
let outsiderAccountId = "";
let outsiderUserId = "";
let perpetualPlanId = "";
let monthlyPlanId = "";
let annualPlanId = "";
const suffix = Date.now().toString(36);

async function confirmPayment(orderId: string) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { attempts: true } });
  const event = {
    eventId: `evt_offer_${orderId}`,
    type: "payment.paid",
    externalPaymentId: `pay_offer_${orderId}`,
    externalCheckoutId: order.attempts[0]!.externalCheckoutId,
    reference: order.number,
    amountMinor: order.totalMinor,
    currency: order.currency,
    livemode: false,
    occurredAt: new Date().toISOString(),
  };
  const raw = Buffer.from(JSON.stringify(event));
  const signature = createHmac("sha256", process.env.SESSION_SECRET!).update(raw).digest("hex");
  const { processPaymentWebhook } = await import("@/lib/webhooks");
  await processPaymentWebhook(raw, new Headers({ "x-mock-signature": signature }));
  expect(await processPaymentWebhook(raw, new Headers({ "x-mock-signature": signature }))).toEqual({ duplicate: true });
}

describe.sequential("discount offers and immutable pricing", () => {
  beforeAll(async () => {
    const admin = await db.user.create({ data: { email: `offer-admin-${suffix}@bke.test`, name: "Offer Admin", role: "ADMIN", emailVerified: new Date() } });
    adminId = admin.id;
    const customer = await db.user.create({ data: { email: `offer-customer-${suffix}@bke.test`, name: "Offer Customer", emailVerified: new Date(), ownedAccounts: { create: { type: "INDIVIDUAL", displayName: "Offer Customer", billingEmail: `offer-customer-${suffix}@bke.test` } } }, include: { ownedAccounts: true } });
    userId = customer.id;
    accountId = customer.ownedAccounts[0]!.id;
    const outsider = await db.user.create({ data: { email: `offer-outsider-${suffix}@bke.test`, name: "Offer Outsider", emailVerified: new Date(), ownedAccounts: { create: { type: "INDIVIDUAL", displayName: "Offer Outsider", billingEmail: `offer-outsider-${suffix}@bke.test` } } }, include: { ownedAccounts: true } });
    outsiderAccountId = outsider.ownedAccounts[0]!.id;
    outsiderUserId = outsider.id;
    const sellable = { active: true, product: { active: true, archivedAt: null } } as const;
    perpetualPlanId = (await db.purchasePlan.findFirstOrThrow({ where: { type: "PERPETUAL", active: true, edition: sellable } })).id;
    monthlyPlanId = (await db.purchasePlan.findFirstOrThrow({ where: { type: "MONTHLY", active: true, edition: sellable } })).id;
    annualPlanId = (await db.purchasePlan.findFirstOrThrow({ where: { type: "ANNUAL", active: true, annualDiscountBps: { gt: 0 }, edition: sellable } })).id;
  });
  afterAll(() => db.$disconnect());

  it("applies an account-scoped offer and preserves an immutable order snapshot", async () => {
    const offer = await db.discountOffer.create({ data: { codeNormalized: `HALF_${suffix}`.toUpperCase(), name: "Half price", type: "CUSTOMER_ACCOUNT_OFFER", status: "ACTIVE", discountBps: 5_000, startsAt: new Date(Date.now() - 1_000), customerAccountId: accountId, purchasePlanId: perpetualPlanId, perAccountRedemptionLimit: 1, createdById: adminId } });
    const { createCheckout } = await import("@/lib/checkout");
    const checkout = await createCheckout(userId, perpetualPlanId, accountId, offer.codeNormalized!);
    const order = await db.order.findUniqueOrThrow({ where: { id: checkout.orderId }, include: { items: true, offerRedemption: true } });
    expect(order.totalMinor).toBe(Math.round(order.items[0]!.catalogAmountMinor! / 2));
    expect(order.items[0]!.pricingSnapshot).toMatchObject({ pricingVersion: "OFFER_V1", offer: { id: offer.id, discountBps: 5_000 } });
    expect(order.offerRedemption).toMatchObject({ status: "RESERVED", finalMinor: order.totalMinor });
    await confirmPayment(order.id);
    expect((await db.offerRedemption.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe("APPLIED");
    await expect(createCheckout(userId, perpetualPlanId, accountId, offer.id)).rejects.toThrow("OFFER_ACCOUNT_LIMIT_REACHED");
  });

  it("rejects an offer belonging to another customer account", async () => {
    const offer = await db.discountOffer.create({ data: { codeNormalized: `OUTSIDER_${suffix}`.toUpperCase(), name: "Private offer", type: "CUSTOMER_ACCOUNT_OFFER", status: "ACTIVE", discountBps: 1_000, startsAt: new Date(Date.now() - 1_000), customerAccountId: outsiderAccountId, purchasePlanId: perpetualPlanId, createdById: adminId } });
    const { createCheckout } = await import("@/lib/checkout");
    await expect(createCheckout(userId, perpetualPlanId, accountId, offer.codeNormalized!)).rejects.toThrow("OFFER_NOT_FOUND");
    expect(await db.offerRedemption.count({ where: { offerId: offer.id } })).toBe(0);
  });

  it("serializes concurrent redemptions at the configured global limit", async () => {
    const offer = await db.discountOffer.create({ data: { codeNormalized: `ONLY_ONE_${suffix}`.toUpperCase(), name: "Only one", type: "GENERAL_PROMOTION", status: "ACTIVE", discountBps: 1_000, startsAt: new Date(Date.now() - 1_000), purchasePlanId: perpetualPlanId, maximumRedemptions: 1, createdById: adminId } });
    const { createCheckout } = await import("@/lib/checkout");
    const results = await Promise.allSettled([
      createCheckout(userId, perpetualPlanId, accountId, offer.id),
      createCheckout(outsiderUserId, perpetualPlanId, outsiderAccountId, offer.id),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await db.offerRedemption.count({ where: { offerId: offer.id, status: "RESERVED" } })).toBe(1);
  });

  it("allows an explicitly authorized account-specific complimentary order", async () => {
    const offer = await db.discountOffer.create({ data: { codeNormalized: `COMP_${suffix}`.toUpperCase(), name: "Complimentary license", type: "ADMINISTRATIVE_ADJUSTMENT", status: "ACTIVE", discountBps: 10_000, startsAt: new Date(Date.now() - 1_000), customerAccountId: accountId, purchasePlanId: perpetualPlanId, maximumRedemptions: 1, allowZeroTotal: true, createdById: adminId } });
    const { createCheckout } = await import("@/lib/checkout");
    const checkout = await createCheckout(userId, perpetualPlanId, accountId, offer.id);
    expect(checkout).toMatchObject({ complimentary: true });
    const order = await db.order.findUniqueOrThrow({ where: { id: checkout.orderId }, include: { invoice: true, licenses: true, payments: true } });
    expect(order).toMatchObject({ status: "PAID", totalMinor: 0 });
    expect(order.invoice?.status).toBe("FINAL");
    expect(order.licenses).toHaveLength(1);
    expect(order.payments).toHaveLength(1);
  });

  it("snapshots annual catalog and promotional discounts as separate invoice lines", async () => {
    const offer = await db.discountOffer.create({ data: { codeNormalized: `ANNUAL_HALF_${suffix}`.toUpperCase(), name: "BKE 50%", type: "CUSTOMER_ACCOUNT_OFFER", status: "ACTIVE", discountBps: 5_000, startsAt: new Date(Date.now() - 1_000), customerAccountId: accountId, purchasePlanId: annualPlanId, createdById: adminId } });
    const { createCheckout } = await import("@/lib/checkout");
    const checkout = await createCheckout(userId, annualPlanId, accountId, offer.codeNormalized!);
    const order = await db.order.findUniqueOrThrow({ where: { id: checkout.orderId }, include: { invoice: { include: { lines: true } }, items: true } });
    const lines = order.invoice!.lines;
    expect(lines.some((line) => line.description.startsWith("Annual catalog discount") && line.totalMinor < 0)).toBe(true);
    expect(lines.some((line) => line.description.includes("BKE 50%") && line.description.includes(offer.codeNormalized!) && line.totalMinor < 0)).toBe(true);
    expect(lines.reduce((sum, line) => sum + line.totalMinor, 0)).toBe(order.totalMinor);
    expect(order.invoice!.subtotalMinor).toBeGreaterThan(order.totalMinor);
    expect(order.invoice!.totalMinor).toBe(order.totalMinor);
  });

  it("auto-applies a code-less public promotion and carries it into the invoice", async () => {
    const offer = await db.discountOffer.create({
      data: {
        name: `Welcome annual ${suffix}`,
        type: "GENERAL_PROMOTION",
        status: "ACTIVE",
        discountBps: 7_100,
        startsAt: new Date(Date.now() - 1_000),
        purchasePlanId: annualPlanId,
        maximumRedemptions: 1,
        perAccountRedemptionLimit: 1,
        createdById: adminId,
      },
    });
    const { createCheckout } = await import("@/lib/checkout");
    const checkout = await createCheckout(userId, annualPlanId, accountId);
    const order = await db.order.findUniqueOrThrow({
      where: { id: checkout.orderId },
      include: { invoice: { include: { lines: true } }, items: true, offerRedemption: true },
    });
    const catalogAmountMinor = order.items[0]!.catalogAmountMinor!;
    const expectedDiscountMinor = Math.round((catalogAmountMinor * 7_100) / 10_000);
    expect(order.items[0]).toMatchObject({ offerId: offer.id, offerDiscountBps: 7_100, offerDiscountMinor: expectedDiscountMinor });
    expect(order.totalMinor).toBe(catalogAmountMinor - expectedDiscountMinor);
    expect(order.offerRedemption).toMatchObject({ offerId: offer.id, discountMinor: expectedDiscountMinor, finalMinor: order.totalMinor, status: "RESERVED" });
    expect(order.invoice!.lines.some((line) => line.description.includes(offer.name) && line.totalMinor === -expectedDiscountMinor)).toBe(true);
    expect(order.invoice!.lines.reduce((sum, line) => sum + line.totalMinor, 0)).toBe(order.totalMinor);
    expect(order.invoice!.totalMinor).toBe(order.totalMinor);
    await db.discountOffer.update({ where: { id: offer.id }, data: { status: "DISABLED" } });
  });

  it("applies a monthly offer for exactly the configured number of renewal cycles", async () => {
    const offer = await db.discountOffer.create({ data: { codeNormalized: `TWO_CYCLES_${suffix}`.toUpperCase(), name: "Two discounted cycles", type: "CUSTOMER_ACCOUNT_OFFER", status: "ACTIVE", discountBps: 2_500, startsAt: new Date(Date.now() - 1_000), customerAccountId: accountId, purchasePlanId: monthlyPlanId, discountedBillingCycles: 2, createdById: adminId } });
    const { createCheckout } = await import("@/lib/checkout");
    const first = await createCheckout(userId, monthlyPlanId, accountId, offer.id);
    await confirmPayment(first.orderId);
    const subscription = await db.subscription.findFirstOrThrow({ where: { orderId: first.orderId } });
    expect(subscription).toMatchObject({ discountedCyclesTotal: 2, discountedCyclesConsumed: 1, offerId: offer.id });
    const renewal = await createCheckout(userId, monthlyPlanId, accountId, undefined, subscription.id);
    const renewalOrder = await db.order.findUniqueOrThrow({ where: { id: renewal.orderId }, include: { items: true } });
    expect(renewalOrder.items[0]!.offerId).toBe(offer.id);
    await confirmPayment(renewal.orderId);
    const renewed = await db.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(renewed.discountedCyclesConsumed).toBe(2);
    expect(await db.subscription.count({ where: { id: subscription.id } })).toBe(1);
    const normalRenewal = await createCheckout(userId, monthlyPlanId, accountId, undefined, subscription.id);
    const normalOrder = await db.order.findUniqueOrThrow({ where: { id: normalRenewal.orderId }, include: { items: true } });
    expect(normalOrder.items[0]!.offerId).toBeNull();
    expect(normalOrder.totalMinor).toBe(normalOrder.items[0]!.catalogAmountMinor);
  });
});

import "dotenv/config";
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../../generated/prisma/client";
import { createCheckout } from "@/lib/checkout";
import { createEdition, syncEditionPlans } from "@/lib/edition-plans";
import { paymentProvider } from "@/lib/payments";
import { PayMongoProvider } from "@/lib/payments/paymongo";
import { processPaymentWebhook } from "@/lib/webhooks";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
let userId: string;
let accountId: string;
const outbound = new Map<string, { amount: number; currency: string; quantity: number }[]>();

function plans(monthly = 10_000, discount = 1_000) {
  return { perpetual: { enabled: false }, monthly: { enabled: true, amountMinor: monthly }, annual: { enabled: true, discountBps: discount } };
}

async function fixture() {
  const product = await db.product.create({ data: { slug: `renewal-${randomUUID()}`, name: "Renewal pricing fixture", summary: "Test", description: "Isolated renewal pricing fixture", type: "SAAS", active: true } });
  const edition = await db.$transaction((tx) => createEdition(tx, product.id, { name: "Standard", slug: "standard", features: [], maxUsers: 1, maxDevicesPerUser: 1, updatePolicy: "ACTIVE_TERM", active: true, plans: plans() }));
  const monthly = await db.purchasePlan.findUniqueOrThrow({ where: { editionId_type: { editionId: edition.id, type: "MONTHLY" } } });
  const annual = await db.purchasePlan.findUniqueOrThrow({ where: { editionId_type: { editionId: edition.id, type: "ANNUAL" } } });
  return { edition, monthly, annual };
}

async function assertCommercialTruth(orderId: string, expected: number) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, invoice: { include: { lines: true } } } });
  const providerLines = outbound.get(order.number)!;
  expect(providerLines).toBeDefined();
  expect(providerLines.every((line) => line.currency === order.currency)).toBe(true);
  expect(providerLines.reduce((sum, line) => sum + line.amount * line.quantity, 0)).toBe(expected);
  expect(order.totalMinor).toBe(expected);
  expect(order.items.reduce((sum, item) => sum + item.totalMinor, 0)).toBe(expected);
  expect(order.invoice!.totalMinor).toBe(expected);
  expect(order.invoice!.lines.reduce((sum, line) => sum + line.totalMinor, 0)).toBe(expected);
  return order;
}

async function settle(orderId: string) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { attempts: true } });
  const event = { eventId: `evt_renewal_${orderId}`, type: "payment.paid", externalPaymentId: `pay_renewal_${orderId}`, externalCheckoutId: order.attempts[0]!.externalCheckoutId, reference: order.number, amountMinor: order.totalMinor, currency: order.currency, livemode: false, occurredAt: new Date().toISOString() };
  const raw = Buffer.from(JSON.stringify(event));
  const signature = createHmac("sha256", process.env.SESSION_SECRET!).update(raw).digest("hex");
  await processPaymentWebhook(raw, new Headers({ "x-mock-signature": signature }));
  expect(await processPaymentWebhook(raw, new Headers({ "x-mock-signature": signature }))).toEqual({ duplicate: true });
}

describe.sequential("saved renewal commercial truth", () => {
  beforeAll(async () => {
    const user = await db.user.create({ data: { email: `renewal-${randomUUID()}@bke.test`, name: "Renewal customer", emailVerified: new Date(), ownedAccounts: { create: { type: "INDIVIDUAL", displayName: "Renewal customer", billingEmail: "renewal@bke.test" } } }, include: { ownedAccounts: true } });
    userId = user.id;
    accountId = user.ownedAccounts[0]!.id;
    // Real PayMongo serialization, mocked HTTP only. Settlement remains the
    // configured CI mock provider so no live credentials or requests are used.
    const adapter = new PayMongoProvider({ secretKey: "sk_test_placeholder", webhookSecret: "test-only", livemode: false });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://api.paymongo.com/v1/checkout_sessions");
      const payload = JSON.parse(String(init?.body)).data.attributes;
      outbound.set(payload.reference_number, payload.line_items);
      return new Response(JSON.stringify({ data: { id: `cs_${randomUUID().replaceAll("-", "")}`, attributes: { checkout_url: "https://checkout.paymongo.com/test-only" } } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.spyOn(paymentProvider, "createCheckout").mockImplementation((input) => {
      expect(input.items.reduce((sum, item) => sum + item.amountMinor * item.quantity, 0)).toBe(input.amountMinor);
      return adapter.createCheckout(input);
    });
  });
  afterAll(async () => { vi.restoreAllMocks(); await db.$disconnect(); });

  it.each([
    ["unchanged catalog", 10_000, 1_000],
    ["monthly price changed", 20_000, 1_000],
    ["annual discount changed", 10_000, 500],
    ["price and discount changed", 20_000, 500],
  ])("preserves annual initial and renewal terms: %s", async (_name, monthly, discount) => {
    const { edition, annual } = await fixture();
    const first = await createCheckout(userId, annual.id, accountId);
    const initial = await assertCommercialTruth(first.orderId, 108_000);
    await settle(first.orderId);
    const subscription = await db.subscription.findFirstOrThrow({ where: { orderId: first.orderId } });
    await db.$transaction((tx) => syncEditionPlans(tx, edition.id, plans(Number(monthly), Number(discount))));
    const renewal = await createCheckout(userId, annual.id, accountId, undefined, subscription.id);
    const order = await assertCommercialTruth(renewal.orderId, 108_000);
    expect(order.invoice!.subtotalMinor).toBe(120_000);
    expect(order.invoice!.lines).toEqual(expect.arrayContaining([expect.objectContaining({ description: "Annual catalog discount (10.00%)", totalMinor: -12_000 })]));
    expect(order.items[0]!.pricingSnapshot).toMatchObject({ monthlyBaseAmountMinor: 10_000, grossAnnualAmountMinor: 120_000, annualCatalogDiscountBps: 1_000, annualCatalogDiscountMinor: 12_000, catalogAmountMinor: 108_000 });
    expect(order.items[0]!.entitlementSnapshot).toMatchObject({ annualDiscountBps: 1_000 });
    await settle(renewal.orderId);
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: initial.items[0]!.id } })).pricingSnapshot).toEqual(initial.items[0]!.pricingSnapshot);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).normalRecurringAmountMinor).toBe(108_000);
    // A new purchase still uses the current catalog rather than old renewal terms.
    if (monthly === 20_000 && discount === 500) await assertCommercialTruth((await createCheckout(userId, annual.id, accountId)).orderId, 228_000);
  });

  it.each([false, true])("preserves monthly renewal, catalog changed=%s", async (changed) => {
    const { edition, monthly } = await fixture();
    const first = await createCheckout(userId, monthly.id, accountId);
    await assertCommercialTruth(first.orderId, 10_000);
    await settle(first.orderId);
    const subscription = await db.subscription.findFirstOrThrow({ where: { orderId: first.orderId } });
    if (changed) await db.$transaction((tx) => syncEditionPlans(tx, edition.id, plans(20_000, 500)));
    const order = await assertCommercialTruth((await createCheckout(userId, monthly.id, accountId, undefined, subscription.id)).orderId, 10_000);
    expect(order.invoice!.lines).toHaveLength(1);
  });

  it.each(["missing snapshot", "inconsistent breakdown", "unmapped original item", "unknown version"])("uses a saved-amount line for %s", async (kind) => {
    const { edition, annual } = await fixture();
    const first = await createCheckout(userId, annual.id, accountId);
    await settle(first.orderId);
    const subscription = await db.subscription.findFirstOrThrow({ where: { orderId: first.orderId } });
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: first.orderId } });
    const saved = item.pricingSnapshot as Prisma.JsonObject;
    await db.orderItem.update({ where: { id: item.id }, data: kind === "unmapped original item" ? { purchasePlanId: null } : { pricingSnapshot: kind === "missing snapshot" ? Prisma.DbNull : { ...saved, ...(kind === "unknown version" ? { pricingVersion: "UNKNOWN" } : { annualCatalogDiscountMinor: 1 }) } } });
    await db.$transaction((tx) => syncEditionPlans(tx, edition.id, plans(20_000, 500)));
    const order = await assertCommercialTruth((await createCheckout(userId, annual.id, accountId, undefined, subscription.id)).orderId, 108_000);
    expect(order.invoice!.lines).toHaveLength(1);
    expect(order.invoice!.subtotalMinor).toBe(108_000);
    expect(order.items[0]!.pricingSnapshot).not.toHaveProperty("annualCatalogDiscountBps");
    expect(order.items[0]!.entitlementSnapshot).toMatchObject({ annualDiscountBps: null });
  });

  it.each([false, true])("applies a renewal promotion once, historical breakdown missing=%s", async (missing) => {
    const { edition, annual } = await fixture();
    const first = await createCheckout(userId, annual.id, accountId);
    await settle(first.orderId);
    const subscription = await db.subscription.findFirstOrThrow({ where: { orderId: first.orderId } });
    if (missing) await db.orderItem.updateMany({ where: { orderId: first.orderId }, data: { pricingSnapshot: Prisma.DbNull } });
    await db.$transaction((tx) => syncEditionPlans(tx, edition.id, plans(20_000, 500)));
    const offer = await db.discountOffer.create({ data: { name: "Renewal promotion fixture", type: "CUSTOMER_ACCOUNT_OFFER", status: "ACTIVE", discountBps: 2_500, startsAt: new Date(Date.now() - 1_000), customerAccountId: accountId, purchasePlanId: annual.id, createdById: userId } });
    const renewal = await createCheckout(userId, annual.id, accountId, offer.id, subscription.id);
    const order = await assertCommercialTruth(renewal.orderId, 81_000);
    expect(order.invoice!.lines.filter((line) => line.description.startsWith("Promotional discount"))).toEqual([expect.objectContaining({ totalMinor: -27_000 })]);
    expect(order.invoice!.lines).toHaveLength(missing ? 2 : 3);
    await settle(renewal.orderId);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).normalRecurringAmountMinor).toBe(108_000);
  });

  it("does not reuse an initial annual promotional final as the normal renewal amount", async () => {
    const { edition, annual } = await fixture();
    const offer = await db.discountOffer.create({ data: { name: "Initial annual promotion fixture", type: "CUSTOMER_ACCOUNT_OFFER", status: "ACTIVE", discountBps: 2_500, startsAt: new Date(Date.now() - 1_000), customerAccountId: accountId, purchasePlanId: annual.id, createdById: userId } });
    const first = await createCheckout(userId, annual.id, accountId, offer.id);
    const original = await assertCommercialTruth(first.orderId, 81_000);
    await settle(first.orderId);
    const subscription = await db.subscription.findFirstOrThrow({ where: { orderId: first.orderId } });
    expect(subscription.normalRecurringAmountMinor).toBe(108_000);
    await db.$transaction((tx) => syncEditionPlans(tx, edition.id, plans(20_000, 500)));
    const order = await assertCommercialTruth((await createCheckout(userId, annual.id, accountId, undefined, subscription.id)).orderId, 108_000);
    expect(order.invoice!.lines).toHaveLength(2);
    expect(order.invoice!.lines.some((line) => line.description.startsWith("Promotional discount"))).toBe(false);
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: original.items[0]!.id } })).pricingSnapshot).toEqual(original.items[0]!.pricingSnapshot);
  });

  it("keeps monthly scheduled promotions on the saved base until their cycles expire", async () => {
    const { edition, monthly } = await fixture();
    const offer = await db.discountOffer.create({ data: { name: "Monthly cycles fixture", type: "CUSTOMER_ACCOUNT_OFFER", status: "ACTIVE", discountBps: 2_500, discountedBillingCycles: 2, startsAt: new Date(Date.now() - 1_000), customerAccountId: accountId, purchasePlanId: monthly.id, createdById: userId } });
    const first = await createCheckout(userId, monthly.id, accountId, offer.id);
    await assertCommercialTruth(first.orderId, 7_500);
    await settle(first.orderId);
    const subscription = await db.subscription.findFirstOrThrow({ where: { orderId: first.orderId } });
    await db.$transaction((tx) => syncEditionPlans(tx, edition.id, plans(20_000, 500)));
    const second = await createCheckout(userId, monthly.id, accountId, undefined, subscription.id);
    await assertCommercialTruth(second.orderId, 7_500);
    await settle(second.orderId);
    expect(await db.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).toMatchObject({ normalRecurringAmountMinor: 10_000, discountedCyclesConsumed: 2 });
    const order = await assertCommercialTruth((await createCheckout(userId, monthly.id, accountId, undefined, subscription.id)).orderId, 10_000);
    expect(order.invoice!.lines).toHaveLength(1);
  });

  it("preserves legacy amount selection when no recurring amount was saved", async () => {
    const { edition, annual } = await fixture();
    const first = await createCheckout(userId, annual.id, accountId);
    await settle(first.orderId);
    const subscription = await db.subscription.findFirstOrThrow({ where: { orderId: first.orderId } });
    await db.subscription.update({ where: { id: subscription.id }, data: { normalRecurringAmountMinor: null } });
    await db.$transaction((tx) => syncEditionPlans(tx, edition.id, plans(20_000, 500)));
    const order = await assertCommercialTruth((await createCheckout(userId, annual.id, accountId, undefined, subscription.id)).orderId, 228_000);
    expect(order.invoice!.lines).toHaveLength(1);
    expect(order.items[0]!.pricingSnapshot).not.toHaveProperty("annualCatalogDiscountBps");
  });
});

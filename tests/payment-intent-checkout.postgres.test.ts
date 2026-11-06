import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "../platform/persistence/generated/prisma/client";
import { db } from "../platform/host/db";
import {
  findBoundPaymentIntentOrderById,
  findPaymentIntentAttempt,
  paymentIntentAttemptMatches,
  paymentIntentOrderMatches,
  paymentIntentRequestFingerprint,
  paymentIntentSourceReference,
} from "../apps/web/commerce/payment-intent-checkout";

const connectionString = process.env.DATABASE_URL ?? "";
const target = connectionString ? new URL(connectionString) : null;
const isActions = process.env.GITHUB_ACTIONS === "true";
const safeTarget = process.env.NODE_ENV === "test" && target?.protocol === "postgresql:" &&
  target.username === "bke" && target.password === "bke" &&
  ["localhost", "127.0.0.1", "::1"].includes(target.hostname) &&
  target.port === "5432" && target.pathname === "/bke_test";
if (isActions && !safeTarget) {
  throw new Error("Payment Intent order bridge tests require only Actions bke_test at localhost:5432 as bke");
}
const runPostgres = isActions && safeTarget;
const suffix = randomUUID().replaceAll("-", "");
const fixtureId = (label: string) => `pi_bridge_${label}_${suffix}`;
const fixture: { userId?: string; accountId?: string; orderId?: string; sourceReference?: string; catalogAmountMinor?: number } = {};
const principalId = fixtureId("principal");
const offerIdentifier = "fixture-customer-offer";
const requestFingerprint = paymentIntentRequestFingerprint({
  principalId,
  accountId: fixtureId("account"),
  purchasePlanId: fixtureId("plan"),
  offerIdentifier,
  purchaseFor: "SELF",
});

describe.skipIf(!runPostgres)("payment Intent checkout bounded PostgreSQL bridge", () => {
  beforeAll(async () => {
    const price = await db.price.findFirst({
      where: { active: true, billingType: "ONE_TIME", amountMinor: { gt: 1 }, product: { active: true } },
      include: { product: true, licensePolicy: true },
      orderBy: { product: { slug: "asc" } },
    });
    if (!price) throw new Error("CI seed must provide an active positive one-time price");
    const user = await db.user.create({
      data: {
        id: principalId, email: `${suffix}@payment-intent-bridge.invalid`, name: "PI bridge fixture",
        ownedAccounts: { create: { id: fixtureId("account"), type: "INDIVIDUAL", displayName: "PI bridge fixture", billingEmail: "pi-bridge@example.invalid" } },
      },
      include: { ownedAccounts: true },
    });
    fixture.userId = user.id;
    const accountId = user.ownedAccounts[0]!.id;
    const orderId = fixtureId("order");
    const sourceReference = paymentIntentSourceReference(user.id, accountId, fixtureId("nonce"));
    fixture.accountId = accountId;
    fixture.orderId = orderId;
    fixture.sourceReference = sourceReference;
    fixture.catalogAmountMinor = price.amountMinor;
    const discountedTotal = price.amountMinor - 1;
    await db.order.create({
      data: {
        id: orderId, number: fixtureId("number"), accountId: accountId, currency: price.currency,
        subtotalMinor: discountedTotal, taxMinor: 0, totalMinor: discountedTotal,
        billingSnapshot: { name: "PI bridge fixture", email: "pi-bridge@example.invalid" },
        items: { create: {
          id: fixtureId("item"), productId: price.product.id, priceId: price.id, policyId: price.licensePolicy.id,
          productName: price.product.name, priceName: price.name, quantity: 1,
          unitAmountMinor: discountedTotal, totalMinor: discountedTotal, billingType: "ONE_TIME",
          policySnapshot: { maxSeats: price.licensePolicy.maxSeats, maxDevicesPerSeat: price.licensePolicy.maxDevicesPerSeat },
          purchasePlanId: fixtureId("plan"), planType: "PERPETUAL",
        } },
      },
    });
    const savedLines = [{
      productId: price.product.id, priceId: price.id, policyId: price.licensePolicy.id,
      quantity: 1, purchasePlanId: fixtureId("plan"), planType: "PERPETUAL",
    }];
    const binding = {
      principalId: user.id, accountId: accountId, sourceReference: sourceReference,
      nonceHash: sourceReference.slice("checkout:pi:".length), requestFingerprint, purchasePlanId: fixtureId("plan"), offerIdentifier, purchaseFor: "SELF",
      planType: "PERPETUAL", currency: price.currency, fulfillmentMode: "ACCOUNT_ENTITLEMENT",
      renewalSubscriptionId: null, lines: savedLines,
    };
    await db.$executeRaw(Prisma.sql`
      UPDATE "Order"
         SET "sourceReference" = ${sourceReference},
             "fulfillmentMode" = ${"ACCOUNT_ENTITLEMENT"}::"CommerceFulfillmentMode",
             "fulfillmentSnapshot" = ${JSON.stringify({ checkoutBinding: binding })}::jsonb
       WHERE "id" = ${orderId}
    `);
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "PaymentIntentAttempt" (
        "id", "sourceReference", "commercialReference", "provider", "requestFingerprint",
        "amountMinor", "currency", "paymentMethodAllowed", "livemode", "idempotencyKey",
        "idempotencyExpiresAt", "paymentIntentId", "status"
      ) VALUES (
        ${fixtureId("attempt")}, ${sourceReference}, ${orderId}, 'paymongo', ${"a".repeat(64)},
        ${discountedTotal}, ${price.currency}, ARRAY['qrph']::text[], false, ${fixtureId("idem")},
        NOW() + INTERVAL '1 day', ${fixtureId("intent")}, 'AWAITING_PAYMENT_METHOD'
      )
    `);
  });

  afterAll(async () => {
    try {
      if (fixture.sourceReference) {
        await db.$executeRaw(Prisma.sql`DELETE FROM "PaymentIntentAttempt" WHERE "sourceReference" = ${fixture.sourceReference}`);
      }
      if (fixture.orderId) {
        await db.orderItem.deleteMany({ where: { orderId: fixture.orderId } });
        await db.invoice.deleteMany({ where: { orderId: fixture.orderId } });
        await db.order.deleteMany({ where: { id: fixture.orderId } });
      }
      if (fixture.accountId) await db.customerAccount.deleteMany({ where: { id: fixture.accountId } });
      if (fixture.userId) await db.user.deleteMany({ where: { id: fixture.userId } });
    } finally {
      if (runPostgres) await db.$disconnect();
    }
  });

  it("decodes raw Order enums and JSON OrderItems, accepting post-offer totals without repricing", async () => {
    const orderId = fixture.orderId;
    const accountId = fixture.accountId;
    const sourceReference = fixture.sourceReference;
    if (!orderId || !accountId || !sourceReference) throw new Error("Fixture missing");
    const order = await findBoundPaymentIntentOrderById(orderId);
    expect(order).not.toBeNull();
    if (!order) throw new Error("Bound order missing");
    expect(order.status).toBe("PENDING");
    expect(order.fulfillmentMode).toBe("ACCOUNT_ENTITLEMENT");
    expect(order.items).toHaveLength(1);
    expect(order.items[0]?.unitAmountMinor).toBeGreaterThan(0);
    expect(order.items[0]?.unitAmountMinor).not.toBe(fixture.catalogAmountMinor);
    const attempt = await findPaymentIntentAttempt(sourceReference);
    expect(attempt).toEqual({
      sourceReference: sourceReference, commercialReference: orderId,
      provider: "paymongo", amountMinor: order.totalMinor, currency: order.currency, livemode: false,
    });
    expect(attempt && paymentIntentAttemptMatches(attempt, {
      sourceReference: sourceReference, commercialReference: orderId, provider: "paymongo",
      amountMinor: order.totalMinor, currency: order.currency, livemode: false,
    })).toBe(true);
    expect(paymentIntentOrderMatches(order, {
      principalId, accountId: accountId, sourceReference: sourceReference, requestFingerprint,
      purchasePlanId: fixtureId("plan"), offerIdentifier, purchaseFor: "SELF",
    })).toBe(true);
    expect(paymentIntentOrderMatches(order, {
      principalId: "another-principal", accountId: accountId, sourceReference: sourceReference, requestFingerprint,
      purchasePlanId: fixtureId("plan"), offerIdentifier, purchaseFor: "SELF",
    })).toBe(false);
    expect(paymentIntentOrderMatches(order, {
      principalId, accountId: accountId, sourceReference: sourceReference,
      requestFingerprint: paymentIntentRequestFingerprint({
        principalId, accountId: accountId, purchasePlanId: fixtureId("plan"),
        offerIdentifier: "different-offer", purchaseFor: "SELF",
      }), purchasePlanId: fixtureId("plan"), offerIdentifier: "different-offer", purchaseFor: "SELF",
    })).toBe(false);
  });
});

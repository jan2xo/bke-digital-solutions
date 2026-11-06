import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { PrismaClient } from "../platform/persistence/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Fail closed before creating any client if Actions ever points at another DB.
const connectionString = process.env.DATABASE_URL ?? "";
const target = connectionString ? new URL(connectionString) : null;
const isActions = process.env.GITHUB_ACTIONS === "true";
const safeTarget = process.env.NODE_ENV === "test" && target?.protocol === "postgresql:" &&
  target.username === "bke" && target.password === "bke" &&
  ["localhost", "127.0.0.1", "::1"].includes(target.hostname) &&
  target.port === "5432" && target.pathname === "/bke_test";
if (isActions && !safeTarget) {
  throw new Error("Payment receiving PostgreSQL tests require only Actions bke_test at localhost:5432 as bke");
}
const runPostgres = isActions && safeTarget;
const prisma = runPostgres ? new PrismaClient({ adapter: new PrismaPg({ connectionString }) }) : null;

// The normal receiver resolves PayMongo credentials through its environment-backed
// provider configuration. These are fixture-only test credentials; no API request
// is made by webhook verification or settlement.
const webhookSecret = "whsk_bke_postgres_payment_intent_fixture_only";
const providerEnvKeys = ["PAYMENT_PROVIDER", "PROVIDER_CONFIG_SOURCE", "PROVIDER_CONFIG_ALLOW_ENV_FALLBACK", "PAYMONGO_LIVEMODE", "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET"] as const;
const priorProviderEnv = new Map(providerEnvKeys.map((key) => [key, process.env[key]]));
let processPaymentWebhook: typeof import("../apps/web/payments/webhook-processing").processPaymentWebhook;

const suffix = randomUUID().replaceAll("-", "");
const id = (name: string) => `${name}_${suffix}`;
const externalIntentId = `pi_${suffix}`;
const externalPaymentId = `pay_${suffix}`;
const eventTime = Math.floor(Date.now() / 1000);
const fixture: { userId?: string; accountId?: string; productId?: string; policyId?: string; priceId?: string; orderId?: string; orderItemId?: string; amountMinor?: number; currency?: string } = {};

function signedEvent(eventId: string, rawType: string, resource: Record<string, unknown>, livemode = false) {
  const body = JSON.stringify({ data: { id: eventId, attributes: {
    type: rawType, livemode, created_at: eventTime, data: resource,
  } } });
  const signature = createHmac("sha256", webhookSecret).update(`${eventTime}.${body}`).digest("hex");
  return { raw: Buffer.from(body), headers: new Headers({ "paymongo-signature": `t=${eventTime},te=${signature}` }) };
}
function paymentEvent(eventId: string, overrides: { livemode?: boolean; amount?: number; currency?: string; reference?: string; intentId?: string } = {}) {
  return signedEvent(eventId, "payment.paid", {
    id: externalPaymentId,
    type: "payment",
    attributes: {
      amount: overrides.amount ?? fixture.amountMinor,
      currency: overrides.currency ?? fixture.currency,
      payment_intent_id: overrides.intentId ?? externalIntentId,
      reference_number: overrides.reference ?? fixture.orderId,
    },
  }, overrides.livemode ?? false);
}

async function countFinancialRows() {
  if (!prisma || !fixture.orderId) throw new Error("PostgreSQL fixture not initialized");
  const [payments, licenses, invoices, rights, intentFacts] = await Promise.all([
    prisma.payment.count({ where: { orderId: fixture.orderId } }),
    prisma.license.count({ where: { orderId: fixture.orderId, status: "ACTIVE" } }),
    prisma.invoice.count({ where: { orderId: fixture.orderId, status: "FINAL" } }),
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM "Entitlement" WHERE "sourceReference" = ${`commerce:${fixture.orderId}:${fixture.orderItemId}`}`,
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM "PaymentSettlementFact" WHERE "provider" = 'paymongo' AND "paymentIntentId" = ${externalIntentId}`,
  ]);
  return { payments, licenses, invoices, rights: Number(rights[0]?.count ?? 0), intentFacts: Number(intentFacts[0]?.count ?? 0) };
}

describe.skipIf(!runPostgres)("PayMongo PaymentIntent receiving on isolated PostgreSQL", { concurrent: false }, () => {
  beforeAll(async () => {
    if (!prisma) throw new Error("PostgreSQL test client unavailable");
    process.env.PAYMENT_PROVIDER = "paymongo";
    process.env.PROVIDER_CONFIG_SOURCE = "environment";
    process.env.PROVIDER_CONFIG_ALLOW_ENV_FALLBACK = "true";
    process.env.PAYMONGO_LIVEMODE = "false";
    process.env.PAYMONGO_SECRET_KEY = "sk_test_bke_postgres_fixture";
    process.env.PAYMONGO_WEBHOOK_SECRET = webhookSecret;
    ({ processPaymentWebhook } = await import("../apps/web/payments/webhook-processing"));

    const seededPrice = await prisma.price.findFirst({
      where: { active: true, billingType: "ONE_TIME", amountMinor: { gt: 0 }, product: { active: true } },
      include: { product: true, licensePolicy: true },
      orderBy: { product: { slug: "asc" } },
    });
    if (!seededPrice) throw new Error("CI seed must provide an active product with a positive one-time price");
    const seededProduct = seededPrice.product;
    const seededPolicy = seededPrice.licensePolicy;
    fixture.productId = seededProduct.id;
    fixture.policyId = seededPolicy.id;
    fixture.priceId = seededPrice.id;
    fixture.amountMinor = seededPrice.amountMinor;
    fixture.currency = seededPrice.currency;

    const user = await prisma.user.create({
      data: {
        id: id("pi_test_user"), email: `${suffix}@payment-receiving.invalid`, name: "Payment receiving fixture",
        ownedAccounts: { create: { id: id("pi_test_account"), type: "INDIVIDUAL", displayName: "Payment receiving fixture", billingEmail: "billing@payment-receiving.invalid" } },
      }, include: { ownedAccounts: true },
    });
    fixture.userId = user.id;
    fixture.accountId = user.ownedAccounts[0]!.id;
    const totalMinor = seededPrice.amountMinor;
    const order = await prisma.order.create({
      data: {
        id: id("pi_test_order"), number: id("PI-TEST"), accountId: fixture.accountId!, currency: seededPrice.currency,
        subtotalMinor: totalMinor, taxMinor: 0, totalMinor,
        billingSnapshot: { name: "Payment receiving fixture", email: "billing@payment-receiving.invalid" },
        items: { create: { id: id("pi_test_item"), productId: seededProduct.id, priceId: seededPrice.id,
          policyId: fixture.policyId!, productName: seededProduct.name, priceName: seededPrice.name, quantity: 1,
          unitAmountMinor: totalMinor, totalMinor, billingType: "ONE_TIME",
          policySnapshot: { maxSeats: seededPolicy.maxSeats, maxDevicesPerSeat: seededPolicy.maxDevicesPerSeat },
          entitlementSnapshot: { rights: ["payment-receiving-test"] },
        } },
        invoice: { create: { id: id("pi_test_invoice"), number: id("PI-INV"), status: "DRAFT",
          customerSnapshot: { name: "Payment receiving fixture", email: "billing@payment-receiving.invalid" },
          currency: seededPrice.currency, subtotalMinor: totalMinor, taxMinor: 0, totalMinor,
          lines: { create: { id: id("pi_test_invoice_line"), description: seededPrice.name, quantity: 1, unitAmountMinor: totalMinor, totalMinor } },
        } },
      }, include: { items: true },
    });
    fixture.orderId = order.id;
    fixture.orderItemId = order.items[0]!.id;

    // Forward-only library schema is intentionally owned by Payments, not Prisma.
    // Insert the exact real PaymentIntentAttempt record through parameterized SQL.
    await prisma.$executeRaw`
      INSERT INTO "PaymentIntentAttempt" (
        "id", "sourceReference", "commercialReference", "provider", "requestFingerprint", "amountMinor", "currency",
        "paymentMethodAllowed", "livemode", "idempotencyKey", "idempotencyExpiresAt", "paymentIntentId", "status"
      ) VALUES (
        ${id("pi_attempt")}, ${order.id}, ${order.id}, 'paymongo', ${"a".repeat(64)}, ${totalMinor}, ${seededPrice.currency},
        ARRAY['qrph']::text[], false, ${id("pi_idempotency")}, NOW() + INTERVAL '1 day', ${externalIntentId}, 'PROCESSING'
      )
    `;
  });

  afterAll(async () => {
    try {
      if (!prisma) return;
      await prisma.$transaction(async (tx) => {
      const orderId = fixture.orderId;
      if (orderId) {
        await tx.license.deleteMany({ where: { orderId } });
        await tx.$executeRaw`DELETE FROM "Entitlement" WHERE "sourceReference" = ${`commerce:${orderId}:${fixture.orderItemId}`}`;
        await tx.$executeRaw`DELETE FROM "PaymentSettlementFact" WHERE "commercialReference" = ${orderId}`;
        await tx.webhookEvent.deleteMany({ where: { provider: "paymongo", externalEventId: { startsWith: `evt_${suffix}_` } } });
        await tx.$executeRaw`DELETE FROM "PaymentProviderEvent" WHERE "eventId" LIKE ${`evt_${suffix}_%`}`;
        await tx.invoice.deleteMany({ where: { orderId } });
        await tx.payment.deleteMany({ where: { orderId } });
        await tx.paymentAttempt.deleteMany({ where: { orderId } });
        await tx.$executeRaw`DELETE FROM "PaymentIntentAttempt" WHERE "sourceReference" = ${orderId}`;
        await tx.orderItem.deleteMany({ where: { orderId } });
        await tx.order.deleteMany({ where: { id: orderId } });
      }
      if (fixture.accountId) await tx.customerAccount.deleteMany({ where: { id: fixture.accountId } });
      if (fixture.userId) await tx.user.deleteMany({ where: { id: fixture.userId } });
      });
    } finally {
      if (prisma) await prisma.$disconnect();
      for (const key of providerEnvKeys) {
        const previous = priorProviderEnv.get(key);
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }
    }
  });

  it("settles a signed PI payment exactly once, rejects mismatches, and ignores non-financial PI events", async () => {
    if (!prisma || !fixture.orderId) throw new Error("PostgreSQL fixture not initialized");

    // Each invalid event is independently signed and traverses the actual installed
    // PayMongo verifier, Payments ingestion, SQL owner tables, and host receiver.
    for (const [label, overrides] of [
      ["mode", { livemode: true }],
      ["amount", { amount: fixture.amountMinor! + 1 }],
      ["currency", { currency: "USD" }],
      ["reference", { reference: "unrelated-order" }],
      ["intent", { intentId: `pi_wrong_${suffix}` }],
    ] as const) {
      const event = paymentEvent(`evt_${suffix}_${label}`, overrides);
      const expected = label === "mode" ? "PAYMENT_MODE_MISMATCH"
        : label === "amount" ? "PAYMENT_AMOUNT_MISMATCH"
        : label === "currency" ? "PAYMENT_CURRENCY_MISMATCH"
        : label === "reference" ? "PAYMENT_REFERENCE_MISMATCH"
        : "PAYMENT_CHECKOUT_MISMATCH";
      await expect(processPaymentWebhook(event.raw, event.headers)).rejects.toThrow(expected);
      expect(await countFinancialRows()).toEqual({ payments: 0, licenses: 0, invoices: 0, rights: 0, intentFacts: 0 });
    }

    const invalidSignature = paymentEvent(`evt_${suffix}_bad_signature`);
    const badHeaders = new Headers(invalidSignature.headers);
    badHeaders.set("paymongo-signature", `t=${eventTime},te=${"0".repeat(64)}`);
    await expect(processPaymentWebhook(invalidSignature.raw, badHeaders)).rejects.toThrow("PAYMENT_SIGNATURE_INVALID");
    expect(await prisma.webhookEvent.count({ where: { provider: "paymongo", externalEventId: `evt_${suffix}_bad_signature` } })).toBe(0);
    expect(await countFinancialRows()).toEqual({ payments: 0, licenses: 0, invoices: 0, rights: 0, intentFacts: 0 });

    const replayOriginal = paymentEvent(`evt_${suffix}_conflict`, { amount: fixture.amountMinor! + 1 });
    await expect(processPaymentWebhook(replayOriginal.raw, replayOriginal.headers)).rejects.toThrow("PAYMENT_AMOUNT_MISMATCH");
    const replayChanged = paymentEvent(`evt_${suffix}_conflict`, { reference: "changed-reference" });
    await expect(processPaymentWebhook(replayChanged.raw, replayChanged.headers)).rejects.toThrow("PAYMENT_EVENT_REPLAY_CONFLICT");
    expect(await countFinancialRows()).toEqual({ payments: 0, licenses: 0, invoices: 0, rights: 0, intentFacts: 0 });

    const paid = paymentEvent(`evt_${suffix}_paid`);
    await expect(processPaymentWebhook(paid.raw, paid.headers)).resolves.toMatchObject({ processed: true });
    expect(await countFinancialRows()).toEqual({ payments: 1, licenses: 1, invoices: 1, rights: 1, intentFacts: 1 });
    const normalized = await prisma.$queryRaw<Array<{ paymentIntentId: string | null }>>`SELECT "paymentIntentId" FROM "PaymentProviderEvent" WHERE "provider" = 'paymongo' AND "eventId" = ${`evt_${suffix}_paid`}`;
    expect(normalized[0]?.paymentIntentId).toBe(externalIntentId);

    // Same event and distinct provider event for the same payment are both replay-safe.
    await expect(processPaymentWebhook(paid.raw, paid.headers)).resolves.toMatchObject({ duplicate: true });
    const secondEvent = paymentEvent(`evt_${suffix}_paid_again`);
    await expect(processPaymentWebhook(secondEvent.raw, secondEvent.headers)).resolves.toMatchObject({ processed: true });
    expect(await countFinancialRows()).toEqual({ payments: 1, licenses: 1, invoices: 1, rights: 1, intentFacts: 1 });

    for (const [name, resource] of [
      ["intent_succeeded", { id: externalIntentId, type: "payment_intent", attributes: { status: "succeeded" } }],
      ["intent_awaiting", { id: externalIntentId, type: "payment_intent", attributes: { status: "awaiting_payment_method" } }],
      ["qrph_expired", { id: externalIntentId, type: "payment_intent", attributes: { status: "cancelled" } }],
    ] as const) {
      const event = signedEvent(`evt_${suffix}_${name}`, name === "qrph_expired" ? "qrph.expired" : name === "intent_succeeded" ? "payment_intent.succeeded" : "payment_intent.awaiting_payment_method", resource);
      await expect(processPaymentWebhook(event.raw, event.headers)).resolves.toMatchObject({ ignored: true });
    }
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.orderId } })).toMatchObject({ status: "PAID" });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { orderId: fixture.orderId } })).toMatchObject({ status: "FINAL" });
    expect(await prisma.license.count({ where: { orderId: fixture.orderId, status: "ACTIVE" } })).toBe(1);
    expect(await countFinancialRows()).toEqual({ payments: 1, licenses: 1, invoices: 1, rights: 1, intentFacts: 1 });
  });
});

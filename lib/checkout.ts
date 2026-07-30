import "server-only";
import { db } from "@/lib/db";
import { paymentProvider } from "@/lib/payments";
import { randomToken } from "@/lib/security/crypto";

export async function createCheckout(userId: string, accountId: string, requested: Array<{ priceId: string; quantity: number }>) {
  const account = await db.customerAccount.findFirstOrThrow({ where: { id: accountId, OR: [{ ownerId: userId }, { memberships: { some: { userId, role: { in: ["OWNER", "BILLING"] } } } }] } });
  const prices = await db.price.findMany({ where: { id: { in: requested.map((i) => i.priceId) }, active: true, product: { active: true } }, include: { product: true, licensePolicy: true } });
  if (prices.length !== new Set(requested.map((i) => i.priceId)).size) throw new Error("INVALID_PRICE");
  const currency = prices[0]!.currency;
  if (prices.some((p) => p.currency !== currency)) throw new Error("MIXED_CURRENCY");
  const lines = requested.map((r) => { const price = prices.find((p) => p.id === r.priceId)!; return { price, quantity: r.quantity, total: price.amountMinor * r.quantity }; });
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0); const tax = 0; const total = subtotal + tax;
  const idempotencyKey = randomToken();
  const order = await db.$transaction(async (tx) => {
    const suffix = `${Date.now().toString(36).toUpperCase()}${randomToken(4).toUpperCase()}`;
    return tx.order.create({
      data: {
        number: `BKE-${new Date().getUTCFullYear()}-${suffix}`,
        accountId, currency, subtotalMinor: subtotal, taxMinor: tax, totalMinor: total,
        billingSnapshot: { name: account.displayName, email: account.billingEmail },
        items: { create: lines.map(({ price, quantity, total: lineTotal }) => ({
          productId: price.productId, priceId: price.id, policyId: price.licensePolicyId,
          productName: price.product.name, priceName: price.name, quantity,
          unitAmountMinor: price.amountMinor, totalMinor: lineTotal, billingType: price.billingType,
          policySnapshot: { maxSeats: price.licensePolicy.maxSeats, maxDevicesPerSeat: price.licensePolicy.maxDevicesPerSeat, validityDays: price.licensePolicy.validityDays },
        })) },
        attempts: { create: { provider: paymentProvider.name, idempotencyKey, status: "CREATING" } },
        invoice: { create: {
          number: `INV-${new Date().getUTCFullYear()}-${suffix}`,
          customerSnapshot: { name: account.displayName, email: account.billingEmail },
          currency, subtotalMinor: subtotal, taxMinor: tax, totalMinor: total,
          lines: { create: lines.map(({ price, quantity, total: lineTotal }) => ({ description: `${price.product.name} — ${price.name}`, quantity, unitAmountMinor: price.amountMinor, totalMinor: lineTotal })) },
        } },
      },
      include: { items: true },
    });
  });
  try {
    const checkout = await paymentProvider.createCheckout({ orderId: order.id, reference: order.number, amountMinor: total, currency, customer: { name: account.displayName, email: account.billingEmail }, idempotencyKey, items: order.items.map((i) => ({ name: i.productName, description: i.priceName, amountMinor: i.unitAmountMinor, quantity: i.quantity })) });
    await db.paymentAttempt.update({ where: { idempotencyKey }, data: { status: "PENDING", externalCheckoutId: checkout.externalId } });
    return { orderId: order.id, checkoutUrl: checkout.checkoutUrl };
  } catch (error) {
    await db.paymentAttempt.update({ where: { idempotencyKey }, data: { status: "FAILED" } });
    throw error;
  }
}

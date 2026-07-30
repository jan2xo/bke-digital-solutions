import "server-only";
import { db } from "@/lib/db";
import { paymentProvider } from "@/lib/payments";
import { purchasePlanLabel, resolvePurchasePlan } from "@/lib/pricing";
import { randomToken } from "@/lib/security/crypto";

export async function createCheckout(userId: string, purchasePlanId: string, accountId?: string) {
  const access = { OR: [{ ownerId: userId }, { memberships: { some: { userId, role: { in: ["OWNER" as const, "BILLING" as const] } } } }] };
  const account = accountId
    ? await db.customerAccount.findFirstOrThrow({ where: { id: accountId, ...access } })
    : await db.customerAccount.findFirstOrThrow({ where: access, orderBy: { createdAt: "asc" } });
  const plan = await db.purchasePlan.findFirst({
    where: { id: purchasePlanId, active: true, edition: { active: true, product: { active: true, archivedAt: null } } },
    include: { monthlySource: true, edition: { include: { product: true } } },
  });
  if (!plan) throw new Error("INVALID_PURCHASE_PLAN");
  const terms = resolvePurchasePlan(plan);
  const quantity = 1;
  const subtotal = terms.amountMinor;
  const tax = 0;
  const total = subtotal + tax;
  const idempotencyKey = randomToken();
  const planName = purchasePlanLabel(plan.type);
  const entitlementSnapshot = {
    editionName: plan.edition.name,
    features: plan.edition.features,
    maxUsers: plan.edition.maxUsers,
    maxDevicesPerUser: plan.edition.maxDevicesPerUser,
    updatePolicy: plan.edition.updatePolicy,
    planType: plan.type,
    renewalBehavior: plan.renewalBehavior,
    intervalUnit: terms.intervalUnit,
    intervalCount: terms.intervalCount,
    annualDiscountBps: plan.annualDiscountBps,
  };
  const order = await db.$transaction(async (tx) => {
    const suffix = `${Date.now().toString(36).toUpperCase()}${randomToken(4).toUpperCase()}`;
    return tx.order.create({
      data: {
        number: `BKE-${new Date().getUTCFullYear()}-${suffix}`,
        accountId: account.id,
        currency: plan.currency,
        subtotalMinor: subtotal,
        taxMinor: tax,
        totalMinor: total,
        billingSnapshot: { name: account.displayName, email: account.billingEmail },
        items: { create: {
          productId: plan.edition.productId,
          priceId: plan.id,
          policyId: plan.editionId,
          productName: plan.edition.product.name,
          priceName: `${plan.edition.name} — ${planName}`,
          quantity,
          unitAmountMinor: terms.amountMinor,
          totalMinor: total,
          billingType: terms.billingType,
          policySnapshot: { maxSeats: plan.edition.maxUsers, maxDevicesPerSeat: plan.edition.maxDevicesPerUser },
          editionId: plan.editionId,
          purchasePlanId: plan.id,
          editionName: plan.edition.name,
          planName,
          planType: plan.type,
          intervalUnit: terms.intervalUnit,
          intervalCount: terms.intervalCount,
          renewalBehavior: plan.renewalBehavior,
          entitlementSnapshot,
        } },
        attempts: { create: { provider: paymentProvider.name, idempotencyKey, status: "CREATING" } },
        invoice: { create: {
          number: `INV-${new Date().getUTCFullYear()}-${suffix}`,
          customerSnapshot: { name: account.displayName, email: account.billingEmail },
          currency: plan.currency,
          subtotalMinor: subtotal,
          taxMinor: tax,
          totalMinor: total,
          lines: { create: { description: `${plan.edition.product.name} — ${plan.edition.name} — ${planName}`, quantity, unitAmountMinor: terms.amountMinor, totalMinor: total } },
        } },
      },
      include: { items: true },
    });
  });
  try {
    const checkout = await paymentProvider.createCheckout({
      orderId: order.id,
      reference: order.number,
      amountMinor: total,
      currency: plan.currency,
      customer: { name: account.displayName, email: account.billingEmail },
      idempotencyKey,
      items: order.items.map((item) => ({ name: `${item.productName} — ${item.editionName}`, description: `${item.planName}; ${plan.renewalBehavior === "NONE" ? "no renewal" : "customer-authorized renewal"}`, amountMinor: item.unitAmountMinor, quantity: item.quantity })),
    });
    await db.paymentAttempt.update({ where: { idempotencyKey }, data: { status: "PENDING", externalCheckoutId: checkout.externalId, checkoutUrl: checkout.checkoutUrl } });
    return { orderId: order.id, checkoutUrl: checkout.checkoutUrl };
  } catch (error) {
    await db.paymentAttempt.update({ where: { idempotencyKey }, data: { status: "FAILED" } });
    throw error;
  }
}

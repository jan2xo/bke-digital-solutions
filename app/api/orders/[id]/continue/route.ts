import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security/request";
import { apiError } from "@/lib/http";
import { paymentProvider } from "@/lib/payments";
import { randomToken } from "@/lib/security/crypto";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await params;
    const reserved = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const order = await tx.order.findFirst({
        where: { id, status: "PENDING", account: { OR: [{ ownerId: user.id }, { memberships: { some: { userId: user.id, role: { in: ["OWNER", "BILLING"] } } } }] } },
        include: { account: true, items: true, attempts: { where: { status: { in: ["CREATING", "PENDING"] } }, orderBy: { createdAt: "desc" }, take: 1 } },
      });
      if (!order) throw new Error("NOT_FOUND");
      const existing = order.attempts[0];
      if (existing?.status === "PENDING" && existing.checkoutUrl) return { order, checkoutUrl: existing.checkoutUrl, idempotencyKey: null };
      if (existing?.status === "CREATING" && existing.createdAt > new Date(Date.now() - 5 * 60_000)) throw new Error("CHECKOUT_CREATION_IN_PROGRESS");
      if (existing) await tx.paymentAttempt.update({ where: { id: existing.id }, data: { status: "FAILED" } });
      const idempotencyKey = randomToken();
      await tx.paymentAttempt.create({ data: { orderId: order.id, provider: paymentProvider.name, idempotencyKey, status: "CREATING" } });
      return { order, checkoutUrl: null, idempotencyKey };
    });

    if (reserved.checkoutUrl) return NextResponse.json({ checkoutUrl: reserved.checkoutUrl }, { headers: { "Cache-Control": "no-store" } });
    const { order } = reserved;
    const idempotencyKey = reserved.idempotencyKey!;
    try {
      const checkout = await paymentProvider.createCheckout({
        orderId: order.id,
        reference: order.number,
        amountMinor: order.totalMinor,
        currency: order.currency,
        customer: { name: order.account.displayName, email: order.account.billingEmail },
        idempotencyKey,
        items: order.items.map((item) => ({ name: `${item.productName}${item.editionName ? ` — ${item.editionName}` : ""}`, description: item.planName ?? item.priceName, amountMinor: item.unitAmountMinor, quantity: item.quantity })),
      });
      const attempt = await db.$transaction(async (tx) => {
        const current = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
        return tx.paymentAttempt.update({ where: { idempotencyKey }, data: { status: current.status === "PENDING" ? "PENDING" : "CANCELLED", externalCheckoutId: checkout.externalId, checkoutUrl: checkout.checkoutUrl } });
      });
      if (attempt.status !== "PENDING") throw new Error("NOT_FOUND");
      return NextResponse.json({ checkoutUrl: checkout.checkoutUrl }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      await db.paymentAttempt.updateMany({ where: { idempotencyKey, status: "CREATING" }, data: { status: "FAILED" } });
      throw error;
    }
  } catch (error) {
    return apiError(error);
  }
}

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createCheckout } from "@/lib/checkout";
import { assertSameOrigin } from "@/lib/security/request";
import { apiError } from "@/lib/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    if (!user.emailVerified) throw new Error("FORBIDDEN");
    const { id } = await params;
    const subscription = await db.subscription.findFirst({
      where: { id, account: { OR: [{ ownerId: user.id }, { memberships: { some: { userId: user.id, role: { in: ["OWNER", "BILLING"] } } } }] } },
    });
    if (!subscription) throw new Error("NOT_FOUND");
    let planId = subscription.purchasePlanId;
    if (!planId) {
      const legacyItem = await db.orderItem.findFirst({ where: { orderId: subscription.orderId, productId: subscription.productId } });
      const mapped = legacyItem ? await db.purchasePlan.findFirst({ where: { legacyPriceId: legacyItem.priceId, active: true } }) : null;
      planId = mapped?.id ?? null;
    }
    if (!planId) throw new Error("NOT_FOUND");
    return NextResponse.json(await createCheckout(user.id, planId, subscription.accountId, undefined, subscription.id), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

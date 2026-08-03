import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createCheckout } from "@/lib/checkout";
import { assertSameOrigin } from "@/lib/security/request";
import { apiError } from "@/lib/http";
import { z } from "zod";
import { assertLegalAcceptanceCurrent } from "@/lib/legal/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await assertLegalAcceptanceCurrent(user.id);
    if (!user.emailVerified) throw new Error("FORBIDDEN");
    const { id } = await params;
    const { legalVersionIds } = z.object({ legalVersionIds: z.array(z.string().cuid()).length(3) }).strict().parse(await request.json());
    const subscription = await db.subscription.findFirst({
      where: { id, account: { lifecycleState: "ACTIVE", OR: [{ ownerId: user.id }, { memberships: { some: { userId: user.id, role: { in: ["OWNER", "BILLING"] } } } }] } },
    });
    if (!subscription) throw new Error("NOT_FOUND");
    let planId = subscription.purchasePlanId;
    if (!planId) {
      const legacyItem = await db.orderItem.findFirst({ where: { orderId: subscription.orderId, productId: subscription.productId } });
      const mapped = legacyItem ? await db.purchasePlan.findFirst({ where: { legacyPriceId: legacyItem.priceId, active: true } }) : null;
      planId = mapped?.id ?? null;
    }
    if (!planId) throw new Error("NOT_FOUND");
    return NextResponse.json(await createCheckout(user.id, planId, subscription.accountId, undefined, subscription.id, { versionIds: legalVersionIds, request }), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

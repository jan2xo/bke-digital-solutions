import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security/request";
import { apiError } from "@/lib/http";
import { assertLegalAcceptanceCurrent } from "@/lib/legal/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await assertLegalAcceptanceCurrent(user.id);
    const { id } = await params;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const order = await tx.order.findFirst({
        where: { id, status: "PENDING", account: { lifecycleState: "ACTIVE", OR: [{ ownerId: user.id }, { memberships: { some: { userId: user.id, role: { in: ["OWNER", "BILLING"] } } } }] } },
        select: { id: true, accountId: true },
      });
      if (!order) throw new Error("NOT_FOUND");
      await tx.order.update({ where: { id }, data: { status: "CANCELLED" } });
      await tx.paymentAttempt.updateMany({ where: { orderId: id, status: { in: ["CREATING", "PENDING"] } }, data: { status: "CANCELLED" } });
      await tx.auditLog.create({ data: { actorId: user.id, accountId: order.accountId, action: "ORDER_CANCELLED", targetType: "Order", targetId: order.id } });
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ status: "CANCELLED" });
  } catch (error) {
    return apiError(error);
  }
}

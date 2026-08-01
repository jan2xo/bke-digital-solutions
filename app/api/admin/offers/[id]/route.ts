import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/security/request";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";

const schema = z.object({ action: z.enum(["ENABLE", "DISABLE", "REVOKE"]) }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const { id } = await params;
    const input = schema.parse(await request.json());
    const current = await db.discountOffer.findUniqueOrThrow({ where: { id } });
    if (current.status === "REVOKED") throw new Error("INVALID_STATE");
    if (input.action === "REVOKE" && await db.offerRedemption.count({ where: { offerId: id, status: { not: "RELEASED" } } })) throw new Error("OFFER_ALREADY_USED");
    const status = input.action === "ENABLE" ? "ACTIVE" : input.action === "DISABLE" ? "DISABLED" : "REVOKED";
    const offer = await db.discountOffer.update({ where: { id }, data: { status, revokedAt: status === "REVOKED" ? new Date() : null } });
    await db.auditLog.create({ data: { actorId: admin.id, accountId: offer.customerAccountId, action: `OFFER_${input.action}`, targetType: "DiscountOffer", targetId: id, metadata: { previousStatus: current.status, status } } });
    return NextResponse.json(offer);
  } catch (error) { return apiError(error); }
}

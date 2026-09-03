import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { audit } from "@/lib/audit";
import { apiError } from "@/v2/apps/web/http/api-error";

const schema = z.object({ active: z.boolean() }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const { id } = await params;
    const input = schema.parse(await request.json());
    const current = await db.productVersion.findUniqueOrThrow({ where: { id }, select: { id: true, productId: true, version: true, lifecycle: true, active: true } });
    const updated = await db.productVersion.update({ where: { id }, data: { active: input.active } });
    await audit({ actorId: admin.id, action: input.active ? "PRODUCT_VERSION_LICENSING_ENABLED" : "PRODUCT_VERSION_LICENSING_DISABLED", targetType: "ProductVersion", targetId: id, metadata: { productId: current.productId, version: current.version, lifecycle: current.lifecycle, previousActive: current.active, active: input.active } });
    return NextResponse.json({ id: updated.id, version: updated.version, active: updated.active, lifecycle: updated.lifecycle });
  } catch (error) {
    return apiError(error);
  }
}

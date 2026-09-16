import { NextResponse } from "next/server";
import { requireAdmin } from "@/apps/web/auth/session";
import { db } from "@/platform/host/db";
import { assertSameOrigin } from "@/apps/web/http/request";
import { audit } from "@/apps/web/audit";
import { apiError } from "@/apps/web/http/api-error";
import {
  editionPlanInputSchema,
  normalizeEditionPlanForHost,
  synchronizeEditionPlansWithCommerce,
} from "@/apps/web/commerce/edition-plan-management";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await params;
    const input = normalizeEditionPlanForHost(editionPlanInputSchema.parse(await request.json()));
    const edition = await db.$transaction(async (tx) => {
      const updated = await tx.edition.update({ where: { id }, data: { name: input.name, slug: input.slug, description: input.description, features: [...input.features], maxUsers: input.maxUsers, maxDevicesPerUser: input.maxDevicesPerUser, updatePolicy: input.updatePolicy, active: input.active } });
      await synchronizeEditionPlansWithCommerce(tx, id, input.plans);
      return updated;
    });
    await audit({ actorId: admin.id, action: "EDITION_PLANS_UPDATED", targetType: "Edition", targetId: id, metadata: { productId: edition.productId, active: edition.active, planTypes: Object.entries(input.plans).filter(([, value]) => value.enabled).map(([type]) => type), annualDiscountBps: input.plans.annual.enabled ? input.plans.annual.discountBps : null } });
    return NextResponse.json(edition);
  } catch (error) { return apiError(error); }
}

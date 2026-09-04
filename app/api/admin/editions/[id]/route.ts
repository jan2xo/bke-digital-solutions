import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { audit } from "@/lib/audit";
import { apiError } from "@/v2/apps/web/http/api-error";
import { editionPlanSchema, syncEditionPlans } from "@/lib/edition-plans";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await params;
    const input = editionPlanSchema.parse(await request.json());
    const edition = await db.$transaction(async (tx) => {
      const updated = await tx.edition.update({ where: { id }, data: { name: input.name, slug: input.slug, description: input.description, features: input.features, maxUsers: input.maxUsers, maxDevicesPerUser: input.maxDevicesPerUser, updatePolicy: input.updatePolicy, active: input.active } });
      await syncEditionPlans(tx, id, input.plans);
      return updated;
    });
    await audit({ actorId: admin.id, action: "EDITION_PLANS_UPDATED", targetType: "Edition", targetId: id, metadata: { productId: edition.productId, active: edition.active, planTypes: Object.entries(input.plans).filter(([, value]) => value.enabled).map(([type]) => type), annualDiscountBps: input.plans.annual.enabled ? input.plans.annual.discountBps : null } });
    return NextResponse.json(edition);
  } catch (error) { return apiError(error); }
}

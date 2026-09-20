import { NextResponse } from "next/server";
import { requireAdmin } from "@/apps/web/auth/session";
import { db } from "@/platform/host/db";
import { assertSameOrigin } from "@/apps/web/http/request";
import { audit } from "@/apps/web/audit";
import { apiError } from "@/apps/web/http/api-error";
import {
  createEditionWithCommerce,
  editionPlanInputSchema,
  normalizeEditionPlanForHost,
} from "@/apps/web/commerce/edition-plan-management";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await params;
    const input = normalizeEditionPlanForHost(editionPlanInputSchema.parse(await request.json()));
    const { edition } = await db.$transaction((tx) => createEditionWithCommerce(tx, id, input));
    await audit({ actorId: admin.id, action: "EDITION_CREATED", targetType: "Edition", targetId: edition.id, metadata: { productId: id, name: input.name, planTypes: Object.entries(input.plans).filter(([, value]) => value.enabled).map(([type]) => type) } });
    return NextResponse.json(edition, { status: 201 });
  } catch (error) { return apiError(error); }
}

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security/request";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/http";
import { createEdition, editionPlanSchema } from "@/lib/edition-plans";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await params;
    const input = editionPlanSchema.parse(await request.json());
    const edition = await db.$transaction((tx) => createEdition(tx, id, input));
    await audit({ actorId: admin.id, action: "EDITION_CREATED", targetType: "Edition", targetId: edition.id, metadata: { productId: id, name: edition.name, planTypes: Object.entries(input.plans).filter(([, value]) => value.enabled).map(([type]) => type) } });
    return NextResponse.json(edition, { status: 201 });
  } catch (error) { return apiError(error); }
}

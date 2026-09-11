import { NextResponse } from "next/server";
import { z } from "zod";
import { closeOrganization } from "@/v2/apps/web/accounts/organization-operations";
import { requireIdentityUser } from "@/v2/apps/web/auth/session";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";

const schema = z.object({ action: z.literal("close") }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const principal = await requireIdentityUser();
    const { id } = await params;
    schema.parse(await request.json());
    return NextResponse.json(await closeOrganization({ actorId: principal.id, accountId: id }));
  } catch (error) {
    return apiError(error);
  }
}

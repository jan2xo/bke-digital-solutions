import { NextResponse } from "next/server";
import { leaveOrganization } from "@/v2/apps/web/accounts/organization-operations";
import { requireIdentityUser } from "@/v2/apps/web/auth/session";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const principal = await requireIdentityUser();
    const { id } = await params;
    await leaveOrganization({ actorId: principal.id, accountId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  removeOrganizationMember,
  updateOrganizationMemberRole,
} from "@/v2/apps/web/accounts/organization-operations";
import { requireIdentityUser } from "@/v2/apps/web/auth/session";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";

const schema = z.object({ role: z.enum(["OWNER", "BILLING", "LICENSE_MANAGER", "MEMBER"]) }).strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    assertSameOrigin(request);
    const principal = await requireIdentityUser();
    const { id, userId } = await params;
    const input = schema.parse(await request.json());
    return NextResponse.json(
      await updateOrganizationMemberRole({
        actorId: principal.id,
        accountId: id,
        userId,
        role: input.role,
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    assertSameOrigin(request);
    const principal = await requireIdentityUser();
    const { id, userId } = await params;
    await removeOrganizationMember({ actorId: principal.id, accountId: id, userId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

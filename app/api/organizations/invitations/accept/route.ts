import { NextResponse } from "next/server";
import { z } from "zod";
import {
  acceptOrganizationInvitation,
  expirePendingOrganizationInvitations,
} from "@/v2/apps/web/accounts/organization-operations";
import { requireIdentityUser } from "@/v2/apps/web/auth/session";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";

const schema = z.object({ token: z.string().min(20) }).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const principal = await requireIdentityUser();
    const input = schema.parse(await request.json());
    await expirePendingOrganizationInvitations();
    const membership = await acceptOrganizationInvitation({
      userId: principal.id,
      email: principal.email,
      token: input.token,
    });
    return NextResponse.json({ accountId: membership.accountId, role: membership.role });
  } catch (error) {
    return apiError(error);
  }
}

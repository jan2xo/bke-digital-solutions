import { NextResponse } from "next/server";
import { z } from "zod";
import { transferOrganizationOwnership } from "@/apps/web/accounts/organization-operations";
import { requireIdentityUser } from "@/apps/web/auth/session";
import { apiError } from "@/apps/web/http/api-error";
import { assertSameOrigin } from "@/apps/web/http/request";

const schema = z.object({ newOwnerUserId: z.string().cuid() }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const principal = await requireIdentityUser();
    const { id } = await params;
    const input = schema.parse(await request.json());
    return NextResponse.json(
      await transferOrganizationOwnership({
        actorId: principal.id,
        accountId: id,
        newOwnerUserId: input.newOwnerUserId,
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}

import { NextResponse } from "next/server";
import { removeLicenseSeat } from "@/apps/web/licensing/license-seat-management";
import { requireIdentityUser } from "@/apps/web/auth/session";
import { assertSameOrigin } from "@/apps/web/http/request";
import { apiError } from "@/apps/web/http/api-error";
import { assertLegalAcceptanceCurrent } from "@/apps/web/legal/service";
import { db } from "@/platform/host/db";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    assertSameOrigin(request);
    const principal = await requireIdentityUser();
    await assertLegalAcceptanceCurrent(principal.id);
    const { id, userId } = await params;

    const result = await db.$transaction(
      (tx) => removeLicenseSeat(tx, {
        actorId: principal.id,
        licenseId: id,
        targetUserId: userId,
      }),
      { isolationLevel: "Serializable" },
    );

    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}

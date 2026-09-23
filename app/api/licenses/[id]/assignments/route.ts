import { NextResponse } from "next/server";
import { z } from "zod";
import { assignLicenseSeat } from "@/apps/web/licensing/license-seat-management";
import { requireIdentityUser } from "@/apps/web/auth/session";
import { assertSameOrigin } from "@/apps/web/http/request";
import { apiError } from "@/apps/web/http/api-error";
import { assertLegalAcceptanceCurrent } from "@/apps/web/legal/service";
import { db } from "@/platform/host/db";

const schema = z.object({
  userId: z.string().min(1).max(256),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const principal = await requireIdentityUser();
    await assertLegalAcceptanceCurrent(principal.id);
    const { id } = await params;
    const input = schema.parse(await request.json());

    const result = await db.$transaction(
      (tx) => assignLicenseSeat(tx, {
        actorId: principal.id,
        licenseId: id,
        targetUserId: input.userId,
      }),
      { isolationLevel: "Serializable" },
    );

    return NextResponse.json(result, { status: result.status === "ASSIGNED" ? 201 : 200 });
  } catch (error) {
    return apiError(error);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { revealClaimCode } from "@/apps/web/entitlements/claim-codes";
import { requireRecentUser } from "@/apps/web/auth/session";
import { apiError } from "@/apps/web/http/api-error";
import { assertSameOrigin } from "@/apps/web/http/request";
import { assertLegalAcceptanceCurrent } from "@/apps/web/legal/service";
import { requireClaimAccountCapabilityInTransaction } from "@/apps/web/accounts/claim-code-authorization";
import { db } from "@/platform/host/db";

const schema = z.object({
  customerAccountId: z.string().min(1).max(256),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireRecentUser();
    await assertLegalAcceptanceCurrent(user.id);
    const { id } = await params;
    const input = schema.parse(await request.json());

    const result = await db.$transaction(async (tx) => {
      const account = await requireClaimAccountCapabilityInTransaction(
        tx,
        user.id,
        input.customerAccountId,
        "MANAGE_CLAIM_CODES",
      );
      if (account.lifecycleState === "SUSPENDED") throw new Error("SUSPENDED_ACCOUNT");
      if (account.lifecycleState === "CLOSED") throw new Error("CLOSED_ACCOUNT");
      if (account.lifecycleState !== "ACTIVE") throw new Error("ACCOUNT_NOT_ACTIVE");

      const reveal = await revealClaimCode(tx, {
        claimCodeId: id,
        purchaserAccountId: input.customerAccountId,
      });
      if (reveal.status === "AVAILABLE") {
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            accountId: input.customerAccountId,
            action: "CLAIM_CODE_REVEALED",
            targetType: "ClaimCode",
            targetId: id,
            metadata: {},
          },
        });
      }
      return reveal;
    }, { isolationLevel: "Serializable" });

    if (result.status === "AVAILABLE") {
      return NextResponse.json({ claimCode: result.code });
    }
    if (result.status === "FAILED") {
      return NextResponse.json({ error: "CLAIM_CODE_UNAVAILABLE" }, { status: 503 });
    }
    const status = result.code === "NOT_FOUND"
      ? 404
      : result.code === "EXPIRED"
        ? 410
        : 409;
    return NextResponse.json({ error: `CLAIM_CODE_${result.code}` }, { status });
  } catch (error) {
    return apiError(error);
  }
}

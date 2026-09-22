import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeClaimCode } from "@/apps/web/entitlements/claim-codes";
import { requireIdentityUser } from "@/apps/web/auth/session";
import { apiError } from "@/apps/web/http/api-error";
import { assertSameOrigin } from "@/apps/web/http/request";
import { requireClaimAccountCapabilityInTransaction } from "@/apps/web/accounts/claim-code-authorization";
import { db } from "@/platform/host/db";

const schema = z.object({
  code: z.string().min(16).max(128),
  customerAccountId: z.string().min(1).max(256),
}).strict();

class ClaimCodeHttpError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

function reject(code: string, status: number): never {
  throw new ClaimCodeHttpError(code, status);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const principal = await requireIdentityUser();
    if (!principal.emailVerified) reject("EMAIL_NOT_VERIFIED", 403);
    const input = schema.parse(await request.json());

    const result = await db.$transaction(async (tx) => {
      const account = await requireClaimAccountCapabilityInTransaction(
        tx,
        principal.id,
        input.customerAccountId,
        "CLAIM_ENTITLEMENT",
      );
      if (account.lifecycleState === "SUSPENDED") reject("SUSPENDED_ACCOUNT", 409);
      if (account.lifecycleState === "CLOSED") reject("CLOSED_ACCOUNT", 409);
      if (account.lifecycleState !== "ACTIVE") reject("ACCOUNT_NOT_ACTIVE", 403);

      const claim = await consumeClaimCode(tx, {
        code: input.code,
        userId: principal.id,
        accountId: input.customerAccountId,
        verifiedEmail: principal.email,
      });

      if (claim.status === "CLAIMED") {
        await tx.auditLog.create({
          data: {
            actorId: principal.id,
            accountId: input.customerAccountId,
            action: "CLAIM_CODE_REDEEMED",
            targetType: "Entitlement",
            targetId: claim.entitlementId,
            metadata: {
              acquisition: "CLAIM_CODE",
            },
          },
        });
      }
      return claim;
    }, { isolationLevel: "Serializable" });

    if (result.status === "REJECTED") {
      switch (result.code) {
        case "INVALID_CODE": reject("CLAIM_CODE_NOT_FOUND", 404);
        case "ALREADY_CLAIMED": reject("CLAIM_CODE_ALREADY_USED", 409);
        case "REVOKED": reject("CLAIM_CODE_REVOKED", 409);
        case "EXPIRED": reject("CLAIM_CODE_EXPIRED", 410);
        case "RECIPIENT_MISMATCH": reject("CLAIM_CODE_RECIPIENT_MISMATCH", 403);
      }
    }

    return NextResponse.json({
      status: "CLAIMED",
      entitlementId: result.entitlementId,
      customerAccountId: result.accountId,
    }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

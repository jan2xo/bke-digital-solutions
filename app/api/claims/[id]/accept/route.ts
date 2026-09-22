import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeRecipientClaimCode } from "@/apps/web/entitlements/claim-codes";
import { requireIdentityUser } from "@/apps/web/auth/session";
import { apiError } from "@/apps/web/http/api-error";
import { assertSameOrigin } from "@/apps/web/http/request";
import { requireClaimAccountCapabilityInTransaction } from "@/apps/web/accounts/claim-code-authorization";
import { db } from "@/platform/host/db";
import { fulfillClaimedLicense } from "@/apps/web/licensing/entitlement-management";

const schema = z.object({
  customerAccountId: z.string().min(1).max(256),
}).strict();

class RecipientClaimHttpError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

function reject(code: string, status: number): never {
  throw new RecipientClaimHttpError(code, status);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const principal = await requireIdentityUser();
    if (!principal.emailVerified) reject("EMAIL_NOT_VERIFIED", 403);
    const { id } = await params;
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

      const claim = await consumeRecipientClaimCode(tx, {
        claimCodeId: id,
        userId: principal.id,
        accountId: input.customerAccountId,
        verifiedEmail: principal.email,
      });

      if (claim.status === "CLAIMED") {
        const license = await fulfillClaimedLicense(tx, {
          claimCodeId: claim.claimCodeId,
          accountId: input.customerAccountId,
        });
        await tx.auditLog.create({
          data: {
            actorId: principal.id,
            accountId: input.customerAccountId,
            action: "RECIPIENT_CLAIM_ACCEPTED",
            targetType: "Entitlement",
            targetId: claim.entitlementId,
            metadata: {
              acquisition: "RECIPIENT_EMAIL_CLAIM",
              claimCodeId: id,
              licenseId: license.id,
            },
          },
        });
      }
      return claim;
    }, { isolationLevel: "Serializable" });

    if (result.status === "REJECTED") {
      switch (result.code) {
        case "INVALID_CODE": reject("RECIPIENT_CLAIM_NOT_FOUND", 404);
        case "ALREADY_CLAIMED": reject("RECIPIENT_CLAIM_ALREADY_USED", 409);
        case "REVOKED": reject("RECIPIENT_CLAIM_REVOKED", 409);
        case "EXPIRED": reject("RECIPIENT_CLAIM_EXPIRED", 410);
        case "RECIPIENT_MISMATCH": reject("RECIPIENT_CLAIM_EMAIL_MISMATCH", 403);
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

import "server-only";

import type {
  CommerceClaimUnitIssueInput,
  CommerceClaimUnitIssuer,
} from "@bke/commerce/logic/settlement-fulfillment-ports";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { db } from "@/platform/host/db";
import { issueClaimCodes } from "./claim-codes";
import {
  normalizeClaimRecipientEmail,
  validClaimRecipientEmail,
} from "./claim-recipient-email";

export function recipientEmailFromFulfillmentSnapshot(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const value = (snapshot as Record<string, unknown>).recipientEmail;
  if (typeof value !== "string" || !validClaimRecipientEmail(value)) return null;
  return normalizeClaimRecipientEmail(value);
}

export async function issueCommerceClaimUnits(
  tx: Prisma.TransactionClient,
  input: CommerceClaimUnitIssueInput,
) {
  const recipientEmail = recipientEmailFromFulfillmentSnapshot(input.fulfillmentSnapshot);
  if (!recipientEmail) return { status: "REJECTED" as const };

  const result = await issueClaimCodes(tx, {
    orderId: input.orderId,
    orderItemId: input.orderItemId,
    purchaserAccountId: input.purchaserAccountId,
    productId: input.productId,
    editionId: input.editionId,
    purchasePlanId: input.purchasePlanId,
    resourceId: input.resourceId,
    units: input.quantity,
    scopeSnapshot: input.scopeSnapshot,
    grantSnapshot: input.grantSnapshot,
    validFrom: input.validFrom,
    recipientEmail,
  });

  if (result.status === "ISSUED" || result.status === "EXISTING") {
    return { status: result.status, unitCount: result.unitCount } as const;
  }
  if (result.status === "REJECTED") return { status: "REJECTED" as const };
  return { status: "FAILED" as const };
}

export function createCommerceClaimUnitIssuer(): CommerceClaimUnitIssuer {
  return Object.freeze({
    async issue(input: CommerceClaimUnitIssueInput) {
      return db.$transaction(
        (tx) => issueCommerceClaimUnits(tx, input),
        { isolationLevel: "Serializable" },
      );
    },
  });
}

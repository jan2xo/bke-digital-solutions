import "server-only";

import { randomUUID } from "node:crypto";
import {
  createEntitlementsDurableRightGrantCapability,
} from "@bke/entitlements/logic/durable-right-grant";
import type {
  EntitlementsGrantDurableRightInput,
  EntitlementsDurableRightSnapshot,
} from "@bke/entitlements/contracts/durable-right-grant.contract";
import type {
  EntitlementsDurableRightGrantRepository,
} from "@bke/entitlements/logic/durable-right-grant-repository";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { revokeOrderEntitlements } from "./refund-revocation";

type GrantRow = {
  id: string;
  subjectId: string;
  resourceId: string;
  sourceReference: string;
  status: "ACTIVE" | "REVOKED";
  quantity: number;
  scopeSnapshot: unknown;
  grantSnapshot: unknown;
  validFrom: Date;
  validUntil: Date | null;
  createdAt: Date;
};

type ExistingGrantRow = GrantRow & { matches: boolean };

function snapshot(row: GrantRow): EntitlementsDurableRightSnapshot {
  return Object.freeze({
    entitlementId: row.id,
    subjectId: row.subjectId,
    resourceId: row.resourceId,
    sourceReference: row.sourceReference,
    status: row.status,
    quantity: row.quantity,
    scopeSnapshot: row.scopeSnapshot,
    grantSnapshot: row.grantSnapshot,
    validFrom: new Date(row.validFrom),
    validUntil: row.validUntil ? new Date(row.validUntil) : null,
    createdAt: new Date(row.createdAt),
  });
}

/**
 * Adapter to the RELEASED @bke/entitlements durable-right capability,
 * intentionally bound to the parent DS trial SERIALIZABLE transaction.
 *
 * Do NOT use the library's stand-alone pg repository here: it would create a
 * second connection/transaction and allow a grant without its trial license.
 */
function trialGrantRepository(tx: Prisma.TransactionClient): EntitlementsDurableRightGrantRepository {
  return Object.freeze({
    async grant(input: EntitlementsGrantDurableRightInput) {
      const inserted = await tx.$queryRaw<GrantRow[]>`
        INSERT INTO "Entitlement" (
          "id", "subjectId", "resourceId", "sourceReference", "status", "quantity",
          "scopeSnapshot", "grantSnapshot", "validFrom", "validUntil"
        ) VALUES (
          ${randomUUID()}, ${input.subjectId}, ${input.resourceId},
          ${input.sourceReference}, 'ACTIVE', ${input.quantity},
          ${JSON.stringify(input.scopeSnapshot)}::jsonb,
          ${JSON.stringify(input.grantSnapshot)}::jsonb,
          ${input.validFrom}, ${input.validUntil ?? null}
        )
        ON CONFLICT ("sourceReference") DO NOTHING
        RETURNING "id", "subjectId", "resourceId", "sourceReference", "status", "quantity",
                  "scopeSnapshot", "grantSnapshot", "validFrom", "validUntil", "createdAt"
      `;
      if (inserted[0]) {
        return { status: "GRANTED" as const, value: snapshot(inserted[0]) };
      }

      const existing = await tx.$queryRaw<ExistingGrantRow[]>`
        SELECT "id", "subjectId", "resourceId", "sourceReference", "status", "quantity",
               "scopeSnapshot", "grantSnapshot", "validFrom", "validUntil", "createdAt",
               (
                 "status" = 'ACTIVE'
                 AND "subjectId" = ${input.subjectId}
                 AND "resourceId" = ${input.resourceId}
                 AND "quantity" = ${input.quantity}
                 AND "scopeSnapshot" = ${JSON.stringify(input.scopeSnapshot)}::jsonb
                 AND "grantSnapshot" = ${JSON.stringify(input.grantSnapshot)}::jsonb
                 AND "validFrom" = ${input.validFrom}
                 AND "validUntil" IS NOT DISTINCT FROM ${input.validUntil ?? null}::timestamp
               ) AS "matches"
          FROM "Entitlement"
         WHERE "sourceReference" = ${input.sourceReference}
      `;
      const row = existing[0];
      if (!row || !row.matches) {
        return { status: "REJECTED" as const, code: "SOURCE_CONFLICT" as const };
      }
      return { status: "EXISTING" as const, value: snapshot(row) };
    },
  });
}

export function trialOrderEntitlementSource(
  orderId: string,
  orderItemId: string,
): string {
  if (!orderId || !orderItemId) throw new Error("TRIAL_RIGHT_SOURCE_INVALID");
  // The trial's own PAID zero-cost OrderItem is the canonical source record.
  // This exact lineage is understood by current Agent L2 entitlement checks.
  return `commerce:${orderId}:${orderItemId}`;
}

export async function grantTrialDurableRight(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    accountId: string;
    productId: string;
    editionId: string;
    orderId: string;
    orderItemId: string;
    trialId: string;
    licenseId: string;
    source: "ADMIN" | "SELF_SERVICE";
    startsAt: Date;
    endsAt: Date;
    features: readonly string[];
    maxUsers: number;
    maxDevicesPerUser: number;
  }>,
): Promise<string> {
  const capability = createEntitlementsDurableRightGrantCapability(trialGrantRepository(tx));
  const right = await capability.grant({
    subjectId: input.accountId,
    resourceId: input.editionId,
    sourceReference: trialOrderEntitlementSource(input.orderId, input.orderItemId),
    quantity: 1,
    scopeSnapshot: {
      productId: input.productId,
      editionId: input.editionId,
      features: [...input.features],
      maxUsers: input.maxUsers,
      maxDevicesPerUser: input.maxDevicesPerUser,
    },
    grantSnapshot: {
      source: "TRIAL",
      trialId: input.trialId,
      licenseId: input.licenseId,
      orderId: input.orderId,
      orderItemId: input.orderItemId,
      sourceKind: input.source,
      trialEndsAt: input.endsAt.toISOString(),
    },
    validFrom: input.startsAt,
    validUntil: input.endsAt,
  });
  if (right.status !== "GRANTED") {
    // A new trial must create exactly one new right; don't resurrect a
    // previously revoked source or mask persistence errors.
    throw new Error("TRIAL_ENTITLEMENT_GRANT_FAILED");
  }
  return right.value.entitlementId;
}

/**
 * A historical trial may predate durable Entitlements and therefore have no
 * matching row. Absence is safe (no right exists), but an ACTIVE row must be
 * revoked atomically with the trial License and machine activations.
 */
export async function revokeTrialDurableRight(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    orderId: string;
    orderItemId: string;
    accountId: string;
    editionId: string;
    trialId: string;
    actorId: string;
    revokedAt: Date;
  }>,
): Promise<"revoked" | "already_revoked" | "legacy_absent"> {
  const sourceReference = trialOrderEntitlementSource(input.orderId, input.orderItemId);
  const rows = await tx.$queryRaw<Array<{
    id: string;
    subjectId: string;
    resourceId: string;
    status: "ACTIVE" | "REVOKED";
  }>>`
    SELECT "id", "subjectId", "resourceId", "status"
      FROM "Entitlement"
     WHERE "sourceReference" = ${sourceReference}
     FOR UPDATE
  `;
  const row = rows[0];
  if (!row) return "legacy_absent";
  if (row.subjectId !== input.accountId || row.resourceId !== input.editionId) {
    throw new Error("TRIAL_ENTITLEMENT_SOURCE_CONFLICT");
  }
  if (row.status === "REVOKED") return "already_revoked";
  if (row.status !== "ACTIVE") throw new Error("TRIAL_ENTITLEMENT_STATUS_INVALID");

  // Uses the released shared Entitlements revocation capability through the
  // DS transaction-bound adapter. No fresh transaction and no weakened shape.
  const count = await revokeOrderEntitlements(tx, input.orderId, {
    revocationReference: `trial:${input.trialId}:revoked`,
    revocationSnapshot: {
      reason: "TRIAL_REVOKED",
      trialId: input.trialId,
      actorId: input.actorId,
    },
    revokedAt: input.revokedAt,
  });
  if (count !== 1) throw new Error("TRIAL_ENTITLEMENT_REVOCATION_INCONSISTENT");
  return "revoked";
}

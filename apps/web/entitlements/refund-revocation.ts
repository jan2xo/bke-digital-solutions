import "server-only";

import { createEntitlementsDurableRightRevocationCapability } from "@bke/entitlements/logic/durable-right-revocation";
import type {
  EntitlementsDurableRightRevocationRepository,
  EntitlementsDurableRightRevocationRepositoryResult,
} from "@bke/entitlements/logic/durable-right-revocation-repository";
import { PaymentLifecycleError } from "@bke/payments/logic/payment-errors";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";

type RevocationRepositoryInput =
  Parameters<EntitlementsDurableRightRevocationRepository["revoke"]>[0];

type RevocationRow = Readonly<{
  id: string;
  status: "ACTIVE" | "REVOKED";
  revokedAt: Date | null;
  revocationReference: string | null;
  revocationSnapshot: unknown | null;
}>;

export type OrderEntitlementRevocationEvidence = Readonly<{
  revocationReference: string;
  revocationSnapshot: unknown;
  revokedAt: Date;
}>;

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value ?? null;
}

function jsonEquivalent(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function snapshot(row: RevocationRow) {
  if (
    row.status !== "REVOKED"
    || !row.revokedAt
    || !row.revocationReference
    || row.revocationSnapshot === null
  ) {
    throw new Error("ENTITLEMENT_REVOCATION_SHAPE_INVALID");
  }

  return Object.freeze({
    entitlementId: row.id,
    status: "REVOKED" as const,
    revocationReference: row.revocationReference,
    revocationSnapshot: row.revocationSnapshot,
    revokedAt: new Date(row.revokedAt),
  });
}

function createRepository(
  tx: Prisma.TransactionClient,
): EntitlementsDurableRightRevocationRepository {
  return Object.freeze({
    async revoke(
      input: RevocationRepositoryInput,
    ): Promise<EntitlementsDurableRightRevocationRepositoryResult> {
      const updated = await tx.$queryRaw<RevocationRow[]>`
        UPDATE "Entitlement"
           SET "status" = 'REVOKED',
               "revokedAt" = ${input.revokedAt},
               "revocationReference" = ${input.revocationReference},
               "revocationSnapshot" = ${JSON.stringify(input.revocationSnapshot)}::jsonb
         WHERE "id" = ${input.entitlementId}
           AND "status" = 'ACTIVE'
        RETURNING "id", "status"::text AS "status", "revokedAt",
                  "revocationReference", "revocationSnapshot"
      `;
      if (updated[0]) {
        return { status: "REVOKED", value: snapshot(updated[0]) };
      }

      const existing = await tx.$queryRaw<RevocationRow[]>`
        SELECT "id", "status"::text AS "status", "revokedAt",
               "revocationReference", "revocationSnapshot"
          FROM "Entitlement"
         WHERE "id" = ${input.entitlementId}
         LIMIT 1
      `;
      const row = existing[0];
      if (!row) return { status: "REJECTED", code: "NOT_FOUND" };
      if (
        row.status !== "REVOKED"
        || !row.revokedAt
        || !row.revocationReference
        || row.revocationSnapshot === null
      ) {
        return { status: "REJECTED", code: "REVOCATION_CONFLICT" };
      }

      const same = row.revocationReference === input.revocationReference
        && row.revokedAt.getTime() === input.revokedAt.getTime()
        && jsonEquivalent(row.revocationSnapshot, input.revocationSnapshot);
      return same
        ? { status: "EXISTING", value: snapshot(row) }
        : { status: "REJECTED", code: "REVOCATION_CONFLICT" };
    },
  });
}

export async function revokeOrderEntitlements(
  tx: Prisma.TransactionClient,
  orderId: string,
  evidence: OrderEntitlementRevocationEvidence,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT entitlement."id"
      FROM "Entitlement" entitlement
      JOIN "OrderItem" item
        ON entitlement."sourceReference" = ('commerce:' || ${orderId} || ':' || item."id")
     WHERE item."orderId" = ${orderId}
     ORDER BY entitlement."id"
     FOR UPDATE OF entitlement
  `;

  const capability = createEntitlementsDurableRightRevocationCapability(createRepository(tx));
  for (const row of rows) {
    const result = await capability.revoke({
      entitlementId: row.id,
      revocationReference: evidence.revocationReference,
      revocationSnapshot: evidence.revocationSnapshot,
      revokedAt: evidence.revokedAt,
    });
    if (result.status === "FAILED") {
      throw new PaymentLifecycleError("PAYMENT_PROCESSING_RETRYABLE", true);
    }
    if (result.status === "REJECTED") {
      throw new PaymentLifecycleError("PAYMENT_RECONCILIATION_REQUIRED");
    }
  }

  return rows.length;
}

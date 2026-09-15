import "server-only";

import { randomUUID } from "node:crypto";
import {
  createSupportCommandCapability,
  createSupportQueryCapability,
  supportPublicId,
} from "@bke/support/logic/support";
import { createPostgresSupportRepository } from "@bke/support/prisma/repositories/postgres-support-repository";
import type {
  SupportAdminUpdateInput,
  SupportCreateTicketInput,
  SupportEffect,
  SupportTicketSnapshot,
} from "@bke/support/contracts/support.contract";
import { audit } from "@/v2/apps/web/audit";
import { getPostgresPool } from "@/v2/apps/web/persistence/postgres";

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL_REQUIRED");
  return value;
}

const repository = createPostgresSupportRepository(databaseUrl());

async function accessibleAccountIds(userId: string): Promise<readonly string[]> {
  const result = await getPostgresPool().query<{ id: string }>(
    `SELECT DISTINCT a."id"
       FROM "CustomerAccount" a
       LEFT JOIN "Membership" m ON m."accountId" = a."id" AND m."userId" = $1
      WHERE a."ownerId" = $1 OR m."userId" = $1`,
    [userId],
  );
  return result.rows.map((row) => row.id);
}

const context = {
  async resolve(input: { userId: string; accountId: string; orderId?: string | null; licenseId?: string | null }) {
    try {
      const pool = getPostgresPool();
      const accountResult = await pool.query<{
        id: string;
        displayName: string;
        ownerRole: string;
        ownerSuspendedAt: Date | null;
        ownerLifecycleState: string;
      }>(
        `SELECT a."id", a."displayName", u."role"::text AS "ownerRole",
                u."suspendedAt" AS "ownerSuspendedAt",
                u."lifecycleState"::text AS "ownerLifecycleState"
           FROM "CustomerAccount" a
           JOIN "User" u ON u."id" = a."ownerId"
          WHERE a."id" = $1
            AND a."lifecycleState" = 'ACTIVE'
            AND (a."ownerId" = $2 OR EXISTS (
              SELECT 1 FROM "Membership" m
               WHERE m."accountId" = a."id" AND m."userId" = $2
            ))
          LIMIT 1`,
        [input.accountId, input.userId],
      );
      const account = accountResult.rows[0];
      if (!account) return { status: "REJECTED" as const, code: "FORBIDDEN" as const };
      if (account.ownerRole === "ADMIN" || account.ownerSuspendedAt || account.ownerLifecycleState !== "ACTIVE") {
        return { status: "REJECTED" as const, code: "ACCOUNT_NOT_ACTIVE" as const };
      }

      const safeContext: Record<string, unknown> = {
        account: { id: account.id, displayName: account.displayName },
      };

      if (input.orderId) {
        const order = await pool.query(
          `SELECT "id", "number", "status"::text AS "status", "currency", "totalMinor", "createdAt", "paidAt"
             FROM "Order" WHERE "id" = $1 AND "accountId" = $2 LIMIT 1`,
          [input.orderId, input.accountId],
        );
        if (!order.rows[0]) return { status: "REJECTED" as const, code: "ORDER_NOT_FOUND" as const };
        safeContext.order = order.rows[0];
      }

      if (input.licenseId) {
        const parameters: unknown[] = [input.licenseId, input.accountId];
        let orderClause = "";
        if (input.orderId) {
          parameters.push(input.orderId);
          orderClause = ` AND l."orderId" = $3`;
        }
        const license = await pool.query(
          `SELECT l."id", l."publicId", l."status"::text AS "status", l."keyLastFour",
                  l."maxSeats", l."maxDevicesPerSeat", l."expiresAt",
                  p."name" AS "productName", e."name" AS "editionName"
             FROM "License" l
             JOIN "Product" p ON p."id" = l."productId"
             JOIN "Edition" e ON e."id" = l."editionId"
            WHERE l."id" = $1 AND l."accountId" = $2${orderClause}
            LIMIT 1`,
          parameters,
        );
        const row = license.rows[0] as Record<string, unknown> | undefined;
        if (!row) return { status: "REJECTED" as const, code: "LICENSE_NOT_FOUND" as const };
        safeContext.license = {
          id: row.id,
          publicId: row.publicId,
          status: row.status,
          keyLastFour: row.keyLastFour,
          maxSeats: row.maxSeats,
          maxDevicesPerSeat: row.maxDevicesPerSeat,
          expiresAt: row.expiresAt,
          product: { name: row.productName },
          edition: { name: row.editionName },
        };
      }

      return { status: "AUTHORIZED" as const, safeContext };
    } catch {
      return { status: "FAILED" as const, code: "CONTEXT_UNAVAILABLE" as const };
    }
  },
};

const commands = createSupportCommandCapability({ repository, context });
const queries = createSupportQueryCapability(repository);

async function executeEffects(effects: readonly SupportEffect[]): Promise<void> {
  for (const effect of effects) {
    if (effect.kind === "AUDIT") {
      await audit(effect);
      continue;
    }
    await getPostgresPool().query(
      `INSERT INTO "EmailOutbox"
         ("id", "type", "recipient", "subject", "payload", "status", "attempts", "deduplicationKey", "createdAt")
       VALUES ($1, $2, $3, $4, $5::jsonb, 'PENDING', 0, $6, NOW())
       ON CONFLICT ("deduplicationKey") DO NOTHING`,
      [randomUUID(), effect.messageType, effect.recipient, effect.subject, JSON.stringify(effect.payload), effect.deduplicationKey],
    );
  }
}

function fail(result: { status: string; code?: string }): never {
  throw new Error(result.code ?? result.status);
}

export { supportPublicId };

export async function createSupportTicket(
  input: Omit<SupportCreateTicketInput, "supportNotificationRecipient">,
): Promise<SupportTicketSnapshot> {
  const supportNotificationRecipient = process.env.SUPPORT_EMAIL?.trim() || "support@example.com";
  const result = await commands.createTicket({ ...input, supportNotificationRecipient });
  if (result.status !== "OK") fail(result);
  await executeEffects(result.effects);
  return result.value;
}

export async function customerReply(input: { userId: string; ticketId: string; body: string }): Promise<{ ok: true }> {
  const result = await commands.customerReply({
    ...input,
    accessibleAccountIds: await accessibleAccountIds(input.userId),
  });
  if (result.status !== "OK") fail(result);
  await executeEffects(result.effects);
  return { ok: true };
}

export async function adminUpdateTicket(input: Omit<SupportAdminUpdateInput, "customerEmail">): Promise<SupportTicketSnapshot> {
  let customerEmail: string | undefined;
  if (input.body) {
    const result = await getPostgresPool().query<{ email: string }>(
      `SELECT u."email" FROM "SupportTicket" t JOIN "User" u ON u."id" = t."createdById" WHERE t."id" = $1 LIMIT 1`,
      [input.ticketId],
    );
    customerEmail = result.rows[0]?.email;
  }
  const result = await commands.adminUpdate({ ...input, ...(customerEmail ? { customerEmail } : {}) });
  if (result.status !== "OK") fail(result);
  await executeEffects(result.effects);
  return result.value;
}

export async function listCustomerTickets(userId: string, limit = 100): Promise<readonly SupportTicketSnapshot[]> {
  const result = await queries.listCustomerTickets({
    userId,
    accessibleAccountIds: await accessibleAccountIds(userId),
    limit,
  });
  if (result.status !== "OK") fail(result);
  return result.values;
}

export async function listAdminTickets(limit = 200): Promise<readonly SupportTicketSnapshot[]> {
  const result = await queries.listAdminTickets(limit);
  if (result.status !== "OK") fail(result);
  return result.values;
}

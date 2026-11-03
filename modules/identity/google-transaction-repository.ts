import type { QueryResult, QueryResultRow } from "pg";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import {
  createTransactionBoundPostgresGoogleIdentityRepository,
} from "@bke/identity/prisma/repositories/postgres-google-identity-repository";

type PrismaTransaction = Prisma.TransactionClient;

/**
 * Adapts the published Identity repository port to the caller-owned Prisma
 * transaction so user, account, legal acceptance, and Google subject commit
 * or roll back together.
 */
export function createPrismaTransactionGoogleIdentityRepository(tx: PrismaTransaction) {
  const pgClient = {
    async query<Row extends QueryResultRow = any>(
      query: string,
      values: readonly unknown[] = [],
    ): Promise<QueryResult<Row>> {
      if (/^\s*INSERT\b/i.test(query)) {
        const rowCount = await tx.$executeRawUnsafe(query, ...values);
        return {
          command: "INSERT",
          rowCount,
          oid: 0,
          rows: [],
          fields: [],
        } as QueryResult<Row>;
      }

      const rows = await tx.$queryRawUnsafe<Row[]>(query, ...values);
      return {
        command: "SELECT",
        rowCount: rows.length,
        oid: 0,
        rows,
        fields: [],
      } as QueryResult<Row>;
    },
  };

  return createTransactionBoundPostgresGoogleIdentityRepository(
    pgClient as Parameters<typeof createTransactionBoundPostgresGoogleIdentityRepository>[0],
  );
}

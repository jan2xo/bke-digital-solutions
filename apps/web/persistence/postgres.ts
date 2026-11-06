import "server-only";

import { Pool } from "pg";
import { currentOperationDatabaseUrl, operationResource } from "@/platform/host/operation-scope";

const globalForPostgres = globalThis as typeof globalThis & {
  bkeV2PostgresPool?: Pool;
};

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("Missing V2 web PostgreSQL environment: DATABASE_URL");
  return value;
}

export function getPostgresPool(): Pool {
  const connectionString = currentOperationDatabaseUrl();
  if (connectionString) {
    return operationResource("postgres-pool", () => new Pool({ connectionString, max: 2 }), (pool) => pool.end());
  }
  if (process.env.BKE_RUNTIME === "workers") throw new Error("WORKER_OPERATION_SCOPE_REQUIRED");
  if (!globalForPostgres.bkeV2PostgresPool) {
    globalForPostgres.bkeV2PostgresPool = new Pool({
      connectionString: databaseUrl(),
      max: 10,
    });
  }
  return globalForPostgres.bkeV2PostgresPool;
}

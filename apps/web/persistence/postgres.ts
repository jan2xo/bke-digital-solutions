import "server-only";

import { Pool } from "pg";

const globalForPostgres = globalThis as typeof globalThis & {
  bkeV2PostgresPool?: Pool;
};

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("Missing V2 web PostgreSQL environment: DATABASE_URL");
  return value;
}

export function getPostgresPool(): Pool {
  if (!globalForPostgres.bkeV2PostgresPool) {
    globalForPostgres.bkeV2PostgresPool = new Pool({
      connectionString: databaseUrl(),
      max: 10,
    });
  }
  return globalForPostgres.bkeV2PostgresPool;
}

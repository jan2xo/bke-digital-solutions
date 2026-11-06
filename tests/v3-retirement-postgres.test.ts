import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const sql = readFileSync("prisma/migrations/20261105180000_v3_business_only_retirement/migration.sql", "utf8");
const retired = ["DownloadGrant", "CommissioningRun", "StorageCleanupJob", "ArtifactUploadSession",
  "SupplyChainVerificationEvidence", "SupplyChainEvidence", "ReleaseApproval", "ProductArtifact"];
const evidence = ["backupEvidence", "complianceEvidence", "migrationEvidence"];
const enums = ["ArtifactUploadState", "CommissioningStatus", "StorageCleanupJobType", "StorageCleanupStatus"];
const suite = process.env.DATABASE_URL ? describe : describe.skip;
let schema: string;
let client: Client;
let writer: Client | undefined;
function identifier(value: string): string { return '"' + value.replaceAll('"', '""') + '"'; }

suite("real PostgreSQL business-only retirement safety", () => {
  beforeAll(() => {
    const hostname = new URL(process.env.DATABASE_URL!).hostname;
    if (process.env.NODE_ENV !== "test" ||
        (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname) &&
          !(hostname === "postgres" && process.env.DEPLOYMENT_ENV === "test"))) {
      throw new Error("Retirement tests require disposable local/test PostgreSQL.");
    }
  });
  beforeEach(async () => {
    schema = "_bke_retirement_test_" + randomUUID().replaceAll("-", "");
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA ${identifier(schema)}`);
    // No public fallback: the real migration can reach only this fixture schema.
    await client.query(`SET search_path TO ${identifier(schema)}, pg_catalog`);
    for (const name of retired) await client.query(`CREATE TABLE ${identifier(name)} ("id" text PRIMARY KEY)`);
    await client.query('CREATE TABLE "ProductVersion" ("id" text PRIMARY KEY, "backupEvidence" jsonb, "complianceEvidence" jsonb, "migrationEvidence" jsonb)');
    for (const name of enums) await client.query(`CREATE TYPE ${identifier(name)} AS ENUM ('FIXTURE')`);
  });
  afterEach(async () => {
    if (writer) {
      await writer.query("ROLLBACK").catch(() => undefined);
      await writer.end();
      writer = undefined;
    }
    if (client) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (!/^_bke_retirement_test_[a-f0-9]+$/.test(schema)) throw new Error("Invalid fixture schema.");
      await client.query("SET search_path TO pg_catalog");
      await client.query(`DROP SCHEMA IF EXISTS ${identifier(schema)} CASCADE`);
      await client.end();
    }
  });
  async function existingTables(): Promise<string[]> {
    const result = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name=ANY($2::text[]) ORDER BY table_name",
      [schema, retired],
    );
    return result.rows.map((row) => row.table_name);
  }
  async function refuse() {
    try { await client.query(sql); } catch (error) {
      await client.query("ROLLBACK");
      return error as Error & { code?: string };
    }
    throw new Error("Expected the real retirement migration to refuse this fixture.");
  }
  it("retires empty legacy structures and preserves the catalog row", async () => {
    await client.query('INSERT INTO "ProductVersion" ("id") VALUES ($1)', ["catalog-row"]);
    await client.query(sql);
    expect(await existingTables()).toEqual([]);
    expect((await client.query('SELECT * FROM "ProductVersion"')).rows).toEqual([{ id: "catalog-row" }]);
    const result = await client.query(
      "SELECT t.typname FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname=ANY($2::text[])",
      [schema, enums],
    );
    expect(result.rows).toHaveLength(0);
  });
  it.each(retired)("refuses populated %s without dropping any legacy table", async (name) => {
    await client.query(`INSERT INTO ${identifier(name)} ("id") VALUES ($1)`, ["preserve-me"]);
    const error = await refuse();
    expect(error.message).toContain("V3_LEGACY_TABLE_NONEMPTY");
    expect(error.message).toContain(name);
    expect(await existingTables()).toEqual([...retired].sort());
    expect((await client.query(`SELECT "id" FROM ${identifier(name)}`)).rows).toEqual([{ id: "preserve-me" }]);
  });
  it.each(evidence)("refuses non-null %s without dropping evidence columns", async (column) => {
    await client.query(`INSERT INTO "ProductVersion" ("id", ${identifier(column)}) VALUES ($1, $2::jsonb)`, ["evidence-row", '{"retain":true}']);
    expect((await refuse()).message).toContain("V3_LEGACY_RELEASE_EVIDENCE_NONEMPTY");
    expect(await existingTables()).toEqual([...retired].sort());
    expect((await client.query(`SELECT ${identifier(column)} AS value FROM "ProductVersion"`)).rows).toEqual([{ value: { retain: true } }]);
  });
  it("times out against a concurrent writer and preserves its committed row", async () => {
    writer = new Client({ connectionString: process.env.DATABASE_URL });
    await writer.connect();
    await writer.query(`SET search_path TO ${identifier(schema)}, pg_catalog`);
    await writer.query("BEGIN");
    await writer.query('INSERT INTO "ProductArtifact" ("id") VALUES ($1)', ["concurrent-row"]);
    expect((await refuse()).code).toBe("55P03");
    await writer.query("COMMIT");
    expect(await existingTables()).toEqual([...retired].sort());
    expect((await client.query('SELECT "id" FROM "ProductArtifact"')).rows).toEqual([{ id: "concurrent-row" }]);
  }, 15_000);
  it("rolls back earlier DDL if an unknown dependent object prevents a later drop", async () => {
    await client.query('CREATE TABLE "UnknownReference" ("artifactId" text REFERENCES "ProductArtifact"("id"))');
    expect((await refuse()).code).toBe("2BP01");
    expect(await existingTables()).toEqual([...retired].sort());
    const columns = await client.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='ProductVersion'",
      [schema],
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining(["id", ...evidence]));
  });
});

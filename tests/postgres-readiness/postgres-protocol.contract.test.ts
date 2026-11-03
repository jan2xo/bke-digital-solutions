import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Opt-in protocol-level PostgreSQL contract test.
 *
 * Point BKE_POSTGRES_READINESS_DATABASE_URL at a disposable database whose
 * database name begins with "bke_readiness_". It intentionally refuses any
 * other database name and creates/drops only a uniquely named temporary schema.
 * This proves PostgreSQL driver/transaction primitives, not application-level
 * commerce or authorization behavior. Those still require route/service tests.
 */
const connectionString = process.env.BKE_POSTGRES_READINESS_DATABASE_URL;
const enabled = Boolean(connectionString);
const schema = `bke_readiness_${randomUUID().replaceAll("-", "")}`;
let pool: Pool | undefined;

function assertDisposableDatabase(url: string): void {
  const parsed = new URL(url);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/^bke_readiness_[a-z0-9_]+$/i.test(databaseName)) {
    throw new Error(
      "Refusing PostgreSQL readiness tests: database name must start with bke_readiness_.",
    );
  }
  if (!parsed.hostname || !parsed.username || !parsed.password) {
    throw new Error("Readiness database URL must include host and credentials.");
  }
}

async function client(): Promise<PoolClient> {
  if (!pool) throw new Error("PostgreSQL readiness pool is not initialized.");
  return pool.connect();
}

describe.skipIf(!enabled)("PostgreSQL readiness protocol contract", () => {
  beforeAll(async () => {
    assertDisposableDatabase(connectionString!);
    pool = new Pool({
      connectionString,
      max: 4,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 2_000,
      maxUses: 20,
      application_name: "bke-postgres-readiness-test",
    });
    await pool.query("SELECT 1");
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(
      `CREATE TABLE "${schema}".ledger (
        id text PRIMARY KEY,
        balance integer NOT NULL CHECK (balance >= 0),
        revoked_at timestamptz NULL
      )`,
    );
    await pool.query(
      `INSERT INTO "${schema}".ledger (id, balance) VALUES ('account-a', 100), ('claim-1', 1)`,
    );
  }, 20_000);

  afterAll(async () => {
    if (pool) {
      try {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await pool.end();
        pool = undefined;
      }
    }
  }, 20_000);

  it("commits changes atomically and rolls back all writes on failure", async () => {
    const c = await client();
    try {
      await c.query("BEGIN");
      await c.query(`UPDATE "${schema}".ledger SET balance = balance - 10 WHERE id = 'account-a'`);
      await c.query(`INSERT INTO "${schema}".ledger (id, balance) VALUES ('rollback-only', 10)`);
      await c.query("ROLLBACK");

      const result = await c.query(
        `SELECT id, balance FROM "${schema}".ledger WHERE id IN ('account-a', 'rollback-only') ORDER BY id`,
      );
      expect(result.rows).toEqual([{ id: "account-a", balance: 100 }]);
    } finally {
      c.release();
    }
  });

  it("preserves PostgreSQL uniqueness and ON CONFLICT idempotency", async () => {
    const first = await pool!.query(
      `INSERT INTO "${schema}".ledger (id, balance) VALUES ('unique-event', 1) ON CONFLICT (id) DO NOTHING RETURNING id`,
    );
    const replay = await pool!.query(
      `INSERT INTO "${schema}".ledger (id, balance) VALUES ('unique-event', 1) ON CONFLICT (id) DO NOTHING RETURNING id`,
    );
    expect(first.rowCount).toBe(1);
    expect(replay.rowCount).toBe(0);
  });

  it("keeps row locks transaction-scoped and supports SKIP LOCKED", async () => {
    const first = await client();
    const second = await client();
    try {
      await first.query("BEGIN");
      const locked = await first.query(
        `SELECT id FROM "${schema}".ledger WHERE id = 'claim-1' FOR UPDATE`,
      );
      expect(locked.rowCount).toBe(1);

      await second.query("BEGIN");
      const skipped = await second.query(
        `SELECT id FROM "${schema}".ledger WHERE id = 'claim-1' FOR UPDATE SKIP LOCKED`,
      );
      expect(skipped.rowCount).toBe(0);

      await first.query("COMMIT");
      const afterRelease = await second.query(
        `SELECT id FROM "${schema}".ledger WHERE id = 'claim-1' FOR UPDATE SKIP LOCKED`,
      );
      expect(afterRelease.rowCount).toBe(1);
      await second.query("ROLLBACK");
    } finally {
      try {
        await first.query("ROLLBACK");
      } catch {
        // A completed transaction is already released.
      }
      try {
        await second.query("ROLLBACK");
      } catch {
        // A completed transaction is already released.
      }
      first.release();
      second.release();
    }
  });

  it("observes a committed revocation on the next uncached database read", async () => {
    await pool!.query(
      `UPDATE "${schema}".ledger SET revoked_at = NULL WHERE id = 'account-a'`,
    );
    await pool!.query(
      `UPDATE "${schema}".ledger SET revoked_at = CURRENT_TIMESTAMP WHERE id = 'account-a'`,
    );
    const result = await pool!.query(
      `SELECT revoked_at IS NOT NULL AS revoked FROM "${schema}".ledger WHERE id = 'account-a'`,
    );
    expect(result.rows[0]?.revoked).toBe(true);
  });
});

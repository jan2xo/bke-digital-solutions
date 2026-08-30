import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "pg";

const moduleName = process.argv[2];

if (!moduleName || !/^[a-z0-9-]+$/.test(moduleName)) {
  throw new Error("A lowercase module name is required.");
}

const moduleRoot = resolve("v2", "modules", moduleName);
const migrationsRoot = join(moduleRoot, "prisma", "migrations");

if (!statSync(migrationsRoot, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error(`No module migration directory found for ${moduleName}.`);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

function migrationDirectories() {
  return readdirSync(migrationsRoot)
    .filter((name) => {
      const path = join(migrationsRoot, name);
      return statSync(path).isDirectory() && statSync(join(path, "migration.sql"), { throwIfNoEntry: false })?.isFile();
    })
    .sort();
}

async function ensureLedger() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "_bke_module_migrations" (
      "moduleId" TEXT NOT NULL,
      "migrationName" TEXT NOT NULL,
      "checksum" TEXT NOT NULL,
      "state" TEXT NOT NULL,
      "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "finishedAt" TIMESTAMPTZ,
      "failedAt" TIMESTAMPTZ,
      "errorCode" TEXT,
      CONSTRAINT "_bke_module_migrations_pkey"
        PRIMARY KEY ("moduleId", "migrationName"),
      CONSTRAINT "_bke_module_migrations_state_check"
        CHECK ("state" IN ('STARTED', 'APPLIED', 'FAILED'))
    )
  `);
}

async function loadRecord(migrationName) {
  const result = await client.query(
    `SELECT "checksum", "state"
       FROM "_bke_module_migrations"
      WHERE "moduleId" = $1 AND "migrationName" = $2`,
    [moduleName, migrationName],
  );
  return result.rows[0] ?? null;
}

async function assertModuleHasNoUnresolvedFailure() {
  const result = await client.query(
    `SELECT "migrationName", "state"
       FROM "_bke_module_migrations"
      WHERE "moduleId" = $1 AND "state" IN ('STARTED', 'FAILED')
      ORDER BY "migrationName"
      LIMIT 1`,
    [moduleName],
  );

  if (result.rowCount > 0) {
    const row = result.rows[0];
    throw new Error(
      `Module ${moduleName} has unresolved migration ${row.migrationName} in state ${row.state}.`,
    );
  }
}

async function markStarted(migrationName, digest) {
  await client.query(
    `INSERT INTO "_bke_module_migrations"
       ("moduleId", "migrationName", "checksum", "state")
     VALUES ($1, $2, $3, 'STARTED')`,
    [moduleName, migrationName, digest],
  );
}

async function markApplied(migrationName) {
  await client.query(
    `UPDATE "_bke_module_migrations"
        SET "state" = 'APPLIED',
            "finishedAt" = CURRENT_TIMESTAMP,
            "failedAt" = NULL,
            "errorCode" = NULL
      WHERE "moduleId" = $1 AND "migrationName" = $2`,
    [moduleName, migrationName],
  );
}

async function markFailed(migrationName, error) {
  const code = typeof error?.code === "string" ? error.code : "UNKNOWN";
  await client.query(
    `UPDATE "_bke_module_migrations"
        SET "state" = 'FAILED',
            "failedAt" = CURRENT_TIMESTAMP,
            "errorCode" = $3
      WHERE "moduleId" = $1 AND "migrationName" = $2`,
    [moduleName, migrationName, code],
  );
}

async function applyMigration(migrationName) {
  const sqlPath = join(migrationsRoot, migrationName, "migration.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const digest = checksum(sql);
  const existing = await loadRecord(migrationName);

  if (existing) {
    if (existing.checksum !== digest) {
      throw new Error(
        `Applied migration checksum changed for ${moduleName}/${migrationName}.`,
      );
    }
    if (existing.state === "APPLIED") {
      console.log(`Already applied: ${moduleName}/${migrationName}`);
      return;
    }
    throw new Error(
      `Migration ${moduleName}/${migrationName} is unresolved in state ${existing.state}.`,
    );
  }

  await markStarted(migrationName, digest);

  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    await markApplied(migrationName);
    console.log(`Applied: ${moduleName}/${migrationName}`);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } finally {
      await markFailed(migrationName, error);
    }
    throw error;
  }
}

await client.connect();

try {
  await ensureLedger();
  await assertModuleHasNoUnresolvedFailure();

  for (const migrationName of migrationDirectories()) {
    await applyMigration(migrationName);
  }

  console.log(`Module migration composition GREEN: ${moduleName}`);
} finally {
  await client.end();
}

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
export const pinned = Object.freeze({
  repository: "jan2xo/bke-digital-solutions",
  actor: "jan2xo",
  orgId: "org-super-mountain-11775863",
  projectId: "tiny-mouse-06099628",
  projectName: "bke-digital-solutions-preproduction",
  branchId: "br-divine-dream-a1qhc381",
  branchName: "preproduction",
  computeHost: "ep-polished-glade-a1u174wx.ap-southeast-1.aws.neon.tech",
  database: "bke_preproduction",
  role: "bke_preproduction_owner",
  region: "aws-ap-southeast-1",
  pgVersion: 17,
});
const connectionParameterAllowlist = new Set(["sslmode", "channel_binding"]);
const postgresOverrides = [
  "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD",
  "PGOPTIONS", "PGSERVICE", "PGSERVICEFILE", "PGSSLMODE",
];

function deny(code) {
  throw new Error("PREPRODUCTION_PRISMA_DENIED_" + code);
}

function parseDirectConnection(raw) {
  let url;
  try { url = new URL(raw); } catch { return deny("INVALID_DIRECT_URL"); }
  if (!["postgresql:", "postgres:"].includes(url.protocol) ||
      url.hostname !== pinned.computeHost || (url.port && url.port !== "5432") ||
      decodeURIComponent(url.pathname.slice(1)) !== pinned.database ||
      decodeURIComponent(url.username) !== pinned.role || !url.password ||
      url.hash || url.searchParams.get("sslmode") === null) {
    deny("WRONG_DATABASE_OR_TLS_TARGET");
  }
  const keys = new Set();
  for (const [key, value] of url.searchParams) {
    if (keys.has(key) || !connectionParameterAllowlist.has(key)) {
      deny("UNAPPROVED_CONNECTION_QUERY_PARAMETER");
    }
    keys.add(key);
    if (key === "sslmode" && !["require", "verify-full"].includes(value)) {
      deny("TLS_IS_REQUIRED");
    }
    if (key === "channel_binding" && value !== "require") {
      deny("CHANNEL_BINDING_MUST_BE_REQUIRED");
    }
  }
  return url;
}

/** Pure fail-closed gate. Invoke before opening any database connection. */
export function validateOperatorContext(env, mode) {
  if (!["preflight", "verify"].includes(mode)) deny("INVALID_OPERATION");
  if (env.GITHUB_ACTIONS !== "true" ||
      !["workflow_dispatch", "issue_comment"].includes(env.GITHUB_EVENT_NAME) ||
      env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_REPOSITORY !== pinned.repository || env.GITHUB_ACTOR !== pinned.actor ||
      !/^[a-f0-9]{40}$/.test(env.SOURCE_SHA ?? "") ||
      env.SOURCE_SHA !== env.GITHUB_SHA) {
    deny("EXACT_MAIN_OWNER_REQUIRED");
  }
  if (env.GITHUB_EVENT_NAME === "issue_comment") {
    let event;
    try {
      if (!env.GITHUB_EVENT_PATH) deny("COMMENT_EVENT_PATH_REQUIRED");
      event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
    } catch {
      deny("COMMENT_EVENT_UNVERIFIABLE");
    }
    const expected = "/preproduction-prisma apply " + env.SOURCE_SHA +
      " APPLY_OFFICIAL_PRISMA_TO_FRESH_BKE_PREPRODUCTION";
    if (event?.action !== "created" ||
        event?.issue?.number !== 378 || event?.issue?.pull_request ||
        event?.issue?.state !== "open" ||
        event?.repository?.full_name !== pinned.repository ||
        event?.comment?.user?.login !== pinned.actor ||
        event?.comment?.body !== expected) {
      deny("EXACT_OWNER_COMMENT_REQUIRED");
    }
  }
  if (env.NODE_ENV !== "production" || env.DEPLOYMENT_ENV !== "staging" ||
      env.PREPRODUCTION_NEON_PROJECT_ID !== pinned.projectId ||
      env.PREPRODUCTION_NEON_BRANCH_ID !== pinned.branchId ||
      env.PREPRODUCTION_DATABASE_NAME !== pinned.database ||
      env.PREPRODUCTION_NEON_HOST !== pinned.computeHost) {
    deny("INDEPENDENT_PREPRODUCTION_IDENTITY_REQUIRED");
  }
  const plannedMode = env.PREPRODUCTION_MIGRATION_MODE;
  if (!["apply_official_migrations", "verify_only"].includes(plannedMode) ||
      mode === "preflight" && plannedMode !== "apply_official_migrations" ||
      env.PREPRODUCTION_MIGRATION_CONFIRMATION !== (
        plannedMode === "apply_official_migrations"
          ? "APPLY_OFFICIAL_PRISMA_TO_FRESH_BKE_PREPRODUCTION"
          : "VERIFY_OFFICIAL_PRISMA_BKE_PREPRODUCTION"
      )) {
    deny("OPERATOR_CONFIRMATION_REQUIRED");
  }
  if (postgresOverrides.some((key) => env[key] !== undefined)) {
    deny("PG_ENV_OVERRIDE_FORBIDDEN");
  }
  if (typeof env.DIRECT_DATABASE_URL !== "string" ||
      env.DATABASE_URL && env.DATABASE_URL !== env.DIRECT_DATABASE_URL) {
    deny("DEDICATED_CREDENTIALS_REQUIRED");
  }
  const url = parseDirectConnection(env.DIRECT_DATABASE_URL);
  return Object.freeze({
    url, mode: plannedMode,
    sourceSha: env.SOURCE_SHA,
  });
}

export function readSourceMigrations(dir = join(process.cwd(), "prisma", "migrations")) {
  const source = new Map();
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!/^\d{14}_[a-z0-9_]+$/.test(entry.name)) {
        deny("SOURCE_MIGRATION_NAME_INVALID");
      }
      const bytes = readFileSync(join(dir, entry.name, "migration.sql"));
      source.set(entry.name, createHash("sha256").update(bytes).digest("hex"));
    }
  } catch {
    return deny("OFFICIAL_SOURCE_MIGRATIONS_UNAVAILABLE");
  }
  if (source.size < 60) deny("OFFICIAL_SOURCE_MIGRATIONS_INCOMPLETE");
  return source;
}

export function verifyMigrationLedger(source, rows) {
  if (!Array.isArray(rows) || rows.length !== source.size) {
    deny("OFFICIAL_MIGRATION_HISTORY_INCOMPLETE");
  }
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.migration_name) ||
        source.get(row.migration_name) !== row.checksum ||
        !row.finished_at || row.rolled_back_at !== null) {
      deny("OFFICIAL_MIGRATION_HISTORY_DIVERGED");
    }
    seen.add(row.migration_name);
  }
  return { officialMigrations: source.size, checksumVerified: true };
}

export function verifySqlIdentity(row, mode) {
  if (row?.database !== pinned.database || row?.db_role !== pinned.role ||
      Number(row.mock_schemas) !== 0 ||
      Number(row.unapproved_schemas) !== 0) {
    deny("CONNECTED_DATABASE_IDENTITY_MISMATCH");
  }
  if (mode === "preflight" && (Number(row.public_tables) !== 0 ||
      row.prisma_ledger != null)) {
    deny("FRESH_DATABASE_NOT_EMPTY");
  }
  if (mode === "verify" && (Number(row.public_tables) === 0 ||
      row.prisma_ledger !== "_prisma_migrations")) {
    deny("OFFICIAL_PRISMA_SCHEMA_NOT_INSTALLED");
  }
  return true;
}

const identitySql = [
  "SELECT current_database() AS database, current_user AS db_role,",
  "(SELECT COUNT(*)::integer FROM pg_tables WHERE schemaname='public') AS public_tables,",
  "(SELECT to_regclass('public._prisma_migrations')::text) AS prisma_ledger,",
  "(SELECT COUNT(*)::integer FROM pg_namespace WHERE nspname LIKE 'bke_startup_mock_%') AS mock_schemas,",
  "(SELECT COUNT(*)::integer FROM pg_namespace WHERE nspname NOT IN",
  " ('public','pg_catalog','pg_toast','information_schema') AND nspname NOT LIKE 'pg_temp_%'",
  " AND nspname NOT LIKE 'pg_toast_temp_%') AS unapproved_schemas",
].join(" ");

async function readOnlySql(url, callback) {
  const client = new Client({
    host: url.hostname, port: 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: pinned.database,
    ssl: { rejectUnauthorized: true, servername: pinned.computeHost },
    connectionTimeoutMillis: 12000, query_timeout: 15000,
  });
  let transaction = false;
  try {
    await client.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transaction = true;
    return await callback(client);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PREPRODUCTION_PRISMA_DENIED_")) {
      throw error;
    }
    deny("SQL_READ_ONLY_VERIFICATION_FAILED");
  } finally {
    if (transaction) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

async function verifyCurrentSchema(client) {
  const ledger = await client.query(
    'SELECT migration_name, checksum, finished_at, rolled_back_at FROM public."_prisma_migrations" ORDER BY migration_name',
  );
  const result = verifyMigrationLedger(readSourceMigrations(), ledger.rows);
  const tables = await client.query(
    "SELECT to_regclass('public.\"User\"') AS users, " +
    "to_regclass('public.\"Product\"') AS products, " +
    "to_regclass('public.\"ProductActivationPolicy\"') AS product_policy, " +
    "to_regclass('public.\"AgentStartupAttestationSigningKey\"') AS agent_key, " +
    "to_regclass('public.\"AccountProductLeaseSigningKey\"') AS signing_key",
  );
  if (Object.values(tables.rows[0] ?? {}).some((value) => value === null)) {
    deny("REQUIRED_APPLICATION_SCHEMA_MISSING");
  }
  const constraint = await client.query(
    "SELECT pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c " +
    "JOIN pg_class t ON t.oid=c.conrelid " +
    "JOIN pg_namespace n ON n.oid=t.relnamespace " +
    "WHERE n.nspname='public' AND t.relname='PurchasePlan' " +
    "AND c.conname='PurchasePlan_terms_check' AND c.contype='c'",
  );
  const definition = constraint.rows[0]?.definition ?? "";
  if (constraint.rows.length !== 1 ||
      !["PERPETUAL", "MONTHLY", "SEMI_ANNUAL", "ANNUAL"]
        .every((plan) => definition.includes(plan))) {
    deny("CURRENT_PLAN_CHECK_CONSTRAINT_MISSING");
  }
  return result;
}

export async function runOperator(mode, env = process.env) {
  // The project/root/endpoint mapping was independently verified against Neon.
  // Runtime trust is the exact TLS host, role, database and read-only SQL target.
  const context = validateOperatorContext(env, mode);
  const result = await readOnlySql(context.url, async (client) => {
    const state = (await client.query(identitySql)).rows[0];
    verifySqlIdentity(state, mode);
    if (mode === "preflight") return { cleanRoot: true };
    return verifyCurrentSchema(client);
  });
  console.info(mode === "preflight"
    ? "PASS: pinned direct Neon endpoint and clean preproduction SQL database; no migration executed by preflight"
    : "PASS: exact official Prisma source checksums, completed history and schema smoke");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  runOperator(mode).catch((error) => {
    const safe = error instanceof Error &&
      error.message.startsWith("PREPRODUCTION_PRISMA_DENIED_")
      ? error.message : "PREPRODUCTION_PRISMA_DENIED_RUNTIME_FAILURE";
    console.error(safe);
    process.exitCode = 1;
  });
}

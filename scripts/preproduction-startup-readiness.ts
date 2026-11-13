import { createHash, createPrivateKey, createPublicKey, timingSafeEqual } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Read-only, staging-only *preflight*. This cannot replace independently
 * verified human ADMIN approval, an installed Agent, or protected Windows
 * positive acceptance. No writes, migrations, or real credentials are issued.
 */
type Env = Record<string, string | undefined>;
export type ReadinessSql = {
  query<T extends Record<string, unknown>>(
    text: string, parameters?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export type StartupReadinessTarget = Readonly<{
  directDatabaseUrl: string;
  expectedDatabase: string;
  expectedAgentKid: string;
  productId: string;
  version: string;
}>;

function deny(code: string): never {
  throw new Error("STARTUP_READINESS_" + code);
}

const kidPattern = /^[A-Za-z0-9._-]{1,128}$/;
const productPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const checksumPattern = /^[0-9a-f]{64}$/;
const sourceMigrationPattern = /^\d{14}_[a-z0-9_]+$/;

function parsePostgres(raw: string | undefined): URL {
  try {
    if (!raw) deny("DATABASE_URL_MISSING");
    const url = new URL(raw);
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
        !url.hostname || !url.username || !url.password ||
        (url.port && url.port !== "5432") ||
        !url.pathname.startsWith("/") || url.pathname.indexOf("/", 1) !== -1)
      deny("DATABASE_CONNECTION_INVALID");
    return url;
  } catch {
    return deny("DATABASE_CONNECTION_INVALID");
  }
}
function endpointHost(host: string): string {
  // Neon pooled and direct endpoint hostnames may differ by this suffix.
  return host.replace(/-pooler(?=\.)/, "");
}
function validOrigin(raw: string | undefined): boolean {
  try {
    if (!raw) return false;
    const value = new URL(raw);
    const host = value.hostname.toLowerCase();
    return value.protocol === "https:" &&
      !value.username && !value.password && value.pathname === "/" &&
      !value.search && !value.hash &&
      host !== "jl-bke.com" && !host.endsWith(".jl-bke.com");
  } catch { return false; }
}

/** Call this BEFORE creating any database connection. */
export function verifyPreproductionStartupTarget(env: Env): StartupReadinessTarget {
  if (env.DEPLOYMENT_ENV !== "staging" ||
      env.NODE_ENV === "test" ||
      env.STANDALONE_STARTUP_POLICY_HTTP_ENABLED !== "true" ||
      env.STANDALONE_STARTUP_POLICY_ISSUANCE_ENABLED !== "true" ||
      env.PREPRODUCTION_ISOLATION_ACK !== "ISOLATED_STAGING_DATABASE" ||
      !validOrigin(env.APP_URL))
    deny("STAGING_OPT_IN_REQUIRED");

  const direct = parsePostgres(env.DIRECT_DATABASE_URL);
  const runtime = parsePostgres(env.DATABASE_URL);
  const expectedHost = env.PREPRODUCTION_DATABASE_HOST?.toLowerCase();
  const expectedDatabase = env.PREPRODUCTION_DATABASE_NAME;
  if (!expectedHost || !/^[a-z0-9][a-z0-9.-]+$/.test(expectedHost) ||
      expectedDatabase !== "bke_staging" &&
      expectedDatabase !== "bke_preproduction" ||
      direct.hostname.toLowerCase() !== expectedHost ||
      endpointHost(runtime.hostname.toLowerCase()) !== expectedHost ||
      decodeURIComponent(direct.pathname.slice(1)) !== expectedDatabase ||
      decodeURIComponent(runtime.pathname.slice(1)) !== expectedDatabase)
    deny("UNPINNED_DATABASE_TARGET");

  const productId = env.PREPRODUCTION_STARTUP_PRODUCT_ID;
  const version = env.PREPRODUCTION_STARTUP_PRODUCT_VERSION;
  const expectedAgentKid = env.PREPRODUCTION_AGENT_KEY_ID;
  if (!productId || !productPattern.test(productId) ||
      !version || !versionPattern.test(version) ||
      !expectedAgentKid || !kidPattern.test(expectedAgentKid))
    deny("EXPECTED_ISSUER_SCOPE_MISSING");
  return {
    directDatabaseUrl: direct.toString(), expectedDatabase,
    productId, version, expectedAgentKid,
  };
}

function expectedSourceMigrations(root: string): Map<string, string> {
  const source = new Map<string, string>();
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !sourceMigrationPattern.test(entry.name))
      continue;
    const sql = readFileSync(join(root, entry.name, "migration.sql"));
    source.set(entry.name, createHash("sha256").update(sql).digest("hex"));
  }
  if (source.size === 0) deny("SOURCE_MIGRATIONS_ABSENT");
  return source;
}
function samePublicKey(privatePem: string, publicPem: string): boolean {
  try {
    const privateKey = createPrivateKey(privatePem);
    const supplied = createPublicKey(publicPem);
    if (privateKey.asymmetricKeyType !== "ed25519" ||
        supplied.asymmetricKeyType !== "ed25519" ||
        supplied.export({ format: "pem", type: "spki" }).toString() !== publicPem)
      return false;
    const expected = createPublicKey(privateKey).export({
      format: "der", type: "spki",
    }) as Buffer;
    const actual = supplied.export({ format: "der", type: "spki" }) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}
function verifiedMachinePublicKey(
  publicPem: string, sha: string, algorithm: string,
): boolean {
  try {
    const key = createPublicKey(publicPem);
    if ((algorithm === "Ed25519" && key.asymmetricKeyType !== "ed25519") ||
        (algorithm === "ES256" && (key.asymmetricKeyType !== "ec" ||
          key.asymmetricKeyDetails?.namedCurve !== "prime256v1")) ||
        !["Ed25519", "ES256"].includes(algorithm) ||
        key.export({ format: "pem", type: "spki" }).toString() !== publicPem ||
        !checksumPattern.test(sha))
      return false;
    const expected = createHash("sha256").update(
      key.export({ format: "der", type: "spki" })).digest("hex");
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sha, "hex"));
  } catch { return false; }
}

export type StartupReadinessProof = Readonly<{
  officialMigrationCount: number;
  productMode: "ACCOUNT" | "LICENSE_KEY" | "EITHER";
  reviewedMachineAlgorithm: "Ed25519" | "ES256";
  sqlEvidenceOnly: true;
}>;

/**
 * Caller MUST enclose this in a REPEATABLE READ, READ ONLY transaction.
 * The method never INSERTs, creates or activates any entity.
 */
export async function auditPreproductionStartupReadiness(
  db: ReadinessSql,
  env: Env,
  sourceMigrationsDirectory = join(process.cwd(), "prisma", "migrations"),
): Promise<StartupReadinessProof> {
  const target = verifyPreproductionStartupTarget(env);
  const context = await db.query<{ database: string }>(
    "SELECT current_database() AS database",
  );
  if (context.rows.length !== 1 ||
      context.rows[0]!.database !== target.expectedDatabase)
    deny("CONNECTED_DATABASE_MISMATCH");

  const mocks = await db.query<{ name: string }>(
    "SELECT nspname AS name FROM pg_namespace " +
    "WHERE nspname LIKE 'bke_startup_mock_%' LIMIT 1",
  );
  if (mocks.rows.length !== 0)
    deny("MOCK_SCHEMA_NOT_AUTHORITY");

  const official = await db.query<{
    migration_name: string; checksum: string;
    finished_at: Date | null; rolled_back_at: Date | null;
  }>(
    'SELECT migration_name, checksum, finished_at, rolled_back_at ' +
    'FROM public."_prisma_migrations" ORDER BY migration_name',
  );
  const source = expectedSourceMigrations(sourceMigrationsDirectory);
  if (official.rows.length !== source.size)
    deny("OFFICIAL_PRISMA_HISTORY_INCOMPLETE");
  const seen = new Set<string>();
  for (const row of official.rows) {
    if (seen.has(row.migration_name) ||
        source.get(row.migration_name) !== row.checksum ||
        !row.finished_at || row.rolled_back_at)
      deny("OFFICIAL_PRISMA_HISTORY_DIVERGED");
    seen.add(row.migration_name);
  }

  const products = await db.query<{ activationMode: string }>(
    'SELECT policy."activationMode" AS "activationMode" ' +
    'FROM "Product" p JOIN "ProductActivationPolicy" policy ' +
    'ON policy."productId"=p."id" JOIN "ProductVersion" pv ' +
    'ON pv."productId"=p."id" WHERE p."productId"=$1 ' +
    'AND pv."version"=$2 AND p."active"=TRUE ' +
    'AND p."publishedAt" IS NOT NULL AND p."archivedAt" IS NULL ' +
    'AND p."launcherExecutionType"=\'STANDALONE\' ' +
    'AND policy."publishedEver"=TRUE AND pv."active"=TRUE ' +
    'AND pv."publishedAt" IS NOT NULL AND pv."lifecycle" IN (\'STABLE\',\'LTS\') ' +
    'AND LOWER(pv."operatingSystem")=\'windows\' ' +
    'AND LOWER(pv."architecture") IN (\'x64\',\'x86_64\',\'amd64\') ' +
    'LIMIT 2',
    [target.productId, target.version],
  );
  if (products.rows.length !== 1 ||
      !["ACCOUNT", "LICENSE_KEY", "EITHER"].includes(
        products.rows[0]!.activationMode))
    deny("PUBLISHED_SQL_PRODUCT_POLICY_MISSING");
  const mode = products.rows[0]!.activationMode as
    "ACCOUNT" | "LICENSE_KEY" | "EITHER";

  const signers = await db.query<{
    kid: string; publicKeyPem: string; privateKeyReference: string;
    status: string; activatedAt: Date | null;
  }>(
    'SELECT "kid", "publicKeyPem", "privateKeyReference", "status", "activatedAt" ' +
    'FROM "AccountProductLeaseSigningKey" WHERE "status"=\'ACTIVE\'',
  );
  if (signers.rows.length !== 1 || !signers.rows[0]!.activatedAt)
    deny("ACTIVE_DS_SIGNER_MISSING");
  const signer = signers.rows[0]!;
  if (!kidPattern.test(signer.kid) ||
      signer.privateKeyReference !== "keyset:" + signer.kid)
    deny("ACTIVE_DS_SIGNER_IDENTITY_INVALID");
  let keyset: Record<string, unknown>;
  try {
    const parsed = JSON.parse(env.ACCOUNT_PRODUCT_LEASE_SIGNING_KEYS_JSON ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      deny("DS_PRIVATE_KEYSET_INVALID");
    keyset = parsed as Record<string, unknown>;
    const ids = Object.keys(keyset);
    if (ids.length < 1 || ids.length > 12 ||
        ids.some(id => !kidPattern.test(id)) ||
        typeof keyset[signer.kid] !== "string")
      deny("DS_PRIVATE_KEYSET_INVALID");
  } catch { return deny("DS_PRIVATE_KEYSET_INVALID"); }
  const pem = keyset[signer.kid];
  if (typeof pem !== "string" ||
      !samePublicKey(pem, signer.publicKeyPem))
    deny("DS_SIGNER_PRIVATE_PUBLIC_MISMATCH");

  const machines = await db.query<{
    kid: string; publicKeyPem: string; publicKeySha256: string;
    algorithm: string; stagedBy: string; activatedBy: string;
    activationProofSha256: string; activatedAt: Date | null;
    reviewedAt: Date | null; revokedAt: Date | null;
    stageRole: string; stageState: string; stageSuspended: Date | null;
    reviewRole: string; reviewState: string; reviewSuspended: Date | null;
  }>(
    'SELECT k."kid",k."publicKeyPem",k."publicKeySha256",k."algorithm", ' +
    'k."stagedBy",k."activatedBy",k."activationProofSha256", ' +
    'k."activatedAt",k."reviewedAt",k."revokedAt", ' +
    'st."role"::text AS "stageRole", st."lifecycleState"::text AS "stageState", ' +
    'st."suspendedAt" AS "stageSuspended", ' +
    'rv."role"::text AS "reviewRole", rv."lifecycleState"::text AS "reviewState", ' +
    'rv."suspendedAt" AS "reviewSuspended" ' +
    'FROM "AgentStartupAttestationSigningKey" k ' +
    'JOIN "User" st ON st."id"=k."stagedBy" ' +
    'JOIN "User" rv ON rv."id"=k."activatedBy" ' +
    'WHERE k."kid"=$1 AND k."status"=\'ACTIVE\'',
    [target.expectedAgentKid],
  );
  const machine = machines.rows[0];
  if (machines.rows.length !== 1 || !machine ||
      !machine.stagedBy || !machine.activatedBy ||
      machine.stagedBy === machine.activatedBy ||
      machine.stageRole !== "ADMIN" || machine.reviewRole !== "ADMIN" ||
      machine.stageState !== "ACTIVE" || machine.reviewState !== "ACTIVE" ||
      machine.stageSuspended || machine.reviewSuspended ||
      !machine.activatedAt || !machine.reviewedAt || machine.revokedAt ||
      !checksumPattern.test(machine.activationProofSha256 || "") ||
      !verifiedMachinePublicKey(
        machine.publicKeyPem, machine.publicKeySha256, machine.algorithm))
    deny("INDEPENDENT_SQL_MACHINE_REVIEW_MISSING");

  const audits = await db.query<{ action: string; actorId: string }>(
    'SELECT "action","actorId" FROM "AuditLog" ' +
    'WHERE "targetType"=\'AgentStartupAttestationSigningKey\' ' +
    'AND "targetId"=$1 AND "action" IN ' +
    '(\'AGENT_STARTUP_MACHINE_KEY_STAGED\', ' +
    '\'AGENT_STARTUP_MACHINE_KEY_ACTIVATED\')',
    [target.expectedAgentKid],
  );
  if (!audits.rows.some(row => row.action ===
        "AGENT_STARTUP_MACHINE_KEY_STAGED" &&
        row.actorId === machine.stagedBy) ||
      !audits.rows.some(row => row.action ===
        "AGENT_STARTUP_MACHINE_KEY_ACTIVATED" &&
        row.actorId === machine.activatedBy))
    deny("MACHINE_APPROVAL_AUDIT_MISSING");

  // This is ONLY SQL/configuration readiness. A human must independently
  // inspect real OIDC ADMIN evidence, installed machine key custody and the
  // protected Windows positive-grant workflow before promoting authority.
  return Object.freeze({
    officialMigrationCount: official.rows.length, productMode: mode,
    reviewedMachineAlgorithm: machine.algorithm as "Ed25519" | "ES256",
    sqlEvidenceOnly: true as const,
  });
}

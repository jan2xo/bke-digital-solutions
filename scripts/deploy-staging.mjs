import { readFile, writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const expected = {
  appUrl: "https://bke-digital-solutions.jlprojectfreedom.workers.dev",
  deploymentEnv: "staging",
  databaseName: "bke_staging",
  databaseRole: "bke_staging_owner",
  deploymentId: "bke-digital-solutions-try",
  redisPrefix: "bke-digital-solutions-try",
  hyperdriveName: "bke-digital-solutions-staging-fresh",
  cloudflareAccountId: "384c6c13373eb94a2925e0d865139970",
};
const configPath = ".wrangler-staging.json";
const secretsPath = ".wrangler-staging-secrets.json";
const requiredSecrets = [
  "GOOGLE_CLIENT_SECRET",
  "SESSION_SECRET",
  "MFA_ENCRYPTION_KEY",
  "LICENSE_PEPPER",
  "LICENSE_SIGNING_PRIVATE_KEY",
  "LICENSE_SIGNING_PUBLIC_KEY",
  "SUPPLY_CHAIN_SIGNING_PRIVATE_KEY",
  "ADMIN_OWNER_RECOVERY_KEY",
  "CRON_SECRET",
];
const optionalSecrets = [
  "REDIS_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "CLAIM_CODE_ENCRYPTION_KEY",
  "AGENT_ACCOUNT_SESSION_PEPPER",
  "AGENT_ACCOUNT_SESSION_ENCRYPTION_KEY",
  "PROVIDER_CREDENTIALS_ENCRYPTION_KEY",
  "BKE_AGENT_UPDATE_SIGNING_KEYS",
  "SUPPLY_CHAIN_SIGNING_PUBLIC_KEY",
  "RELEASE_EVIDENCE_INGESTION_TOKEN",
  "BACKUP_S3_ACCESS_KEY_ID",
  "BACKUP_S3_SECRET_ACCESS_KEY",
  "BACKUP_ENCRYPTION_KEY",
];
const publicVariables = [
  "APP_URL",
  "DEPLOYMENT_ENV",
  "DEPLOYMENT_ID",
  "GOOGLE_CLIENT_ID",
  "PAYMENT_PROVIDER",
  "PAYMONGO_LIVEMODE",
  "EMAIL_PROVIDER",
  "EMAIL_FROM",
  "REDIS_KEY_PREFIX",
  "SUPPORT_EMAIL",
  "BUSINESS_ADDRESS",
  "MAX_ARTIFACT_BYTES",
  "LOG_LEVEL",
  "TRUSTED_ORIGINS",
  "TRUST_PROXY_HOPS",
  "PROVIDER_CONFIG_SOURCE",
  "PROVIDER_CONFIG_ALLOW_ENV_FALLBACK",
  "CLAIM_CODE_CHECKOUT_ENABLED",
  "AGENT_ACCOUNT_SESSION_ENABLED",
  "ALLOW_BREAK_GLASS",
  "ALLOW_DESTRUCTIVE_ADMIN",
  "ADMIN_OWNER_RECOVERY_KEY_VERSION",
  "PROVIDER_CREDENTIALS_KEY_VERSION",
  "SUPPLY_CHAIN_SIGNING_KEY_ID",
  "LICENSE_SIGNING_KEY_ID",
  "BACKUP_ENABLED",
  "BACKUP_S3_ENDPOINT",
  "BACKUP_S3_REGION",
  "BACKUP_BUCKET",
  "BACKUP_S3_FORCE_PATH_STYLE",
  "BACKUP_ENCRYPTION_KEY_VERSION",
  "BACKUP_RETENTION_DAILY",
  "BACKUP_RETENTION_WEEKLY",
  "BACKUP_RETENTION_MONTHLY",
  "BACKUP_WORKER_POLL_SECONDS",
];

function fail(message) {
  throw new Error(message);
}
function required(name, environment = process.env) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) fail(`Missing required Staging setting: ${name}`);
  return value;
}
export function databaseUrl(name, value, expectedHost) {
  let url;
  try { url = new URL(value); } catch { fail(`${name} must be a valid PostgreSQL URL`); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) fail(`${name} must use PostgreSQL`);
  if (decodeURIComponent(url.pathname.slice(1)) !== expected.databaseName) fail(`${name} must target bke_staging`);
  if (decodeURIComponent(url.username) !== expected.databaseRole) fail(`${name} must use bke_staging_owner`);
  if (!expectedHost || url.hostname.toLowerCase() !== expectedHost.toLowerCase()) fail(`${name} must match STAGING_NEON_HOST exactly`);
  if (!url.hostname.endsWith(".neon.tech") || url.hostname.includes("pooler")) fail(`${name} must use a direct unpooled Neon host`);
  if (url.port && url.port !== "5432") fail(`${name} must use port 5432`);
  if (!["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")) fail(`${name} must require TLS`);
  return url;
}
export function assertStagingSettings(env = process.env) {
  if (required("APP_URL", env) !== expected.appUrl) fail("Staging APP_URL does not match the approved Cloudflare-owned origin");
  if (required("DEPLOYMENT_ENV", env) !== expected.deploymentEnv) fail("DEPLOYMENT_ENV must be staging");
  if (required("DEPLOYMENT_ID", env) !== expected.deploymentId) fail("DEPLOYMENT_ID must use the approved isolated Staging namespace");
  if (required("REDIS_KEY_PREFIX", env) !== expected.redisPrefix) fail("REDIS_KEY_PREFIX must use the approved isolated Staging namespace");
  if (required("PAYMENT_PROVIDER", env) !== "mock") fail("Initial Staging requires mock payments");
  if (required("EMAIL_PROVIDER", env) !== "log") fail("Initial Staging requires log-only email");
  if (required("PAYMONGO_LIVEMODE", env) !== "false") fail("PAYMONGO_LIVEMODE must explicitly be false");
  for (const name of ["LOCAL_PRODUCTION_SIMULATION", "ALLOW_BREAK_GLASS", "ALLOW_DESTRUCTIVE_ADMIN", "BACKUP_ENABLED", "CLAIM_CODE_CHECKOUT_ENABLED", "AGENT_ACCOUNT_SESSION_ENABLED"]) {
    if (env[name] === "true") fail(`${name} must remain disabled for isolated authentication Staging`);
  }
  required("GOOGLE_CLIENT_ID", env);
  required("GOOGLE_CLIENT_SECRET", env);
  const host = required("STAGING_NEON_HOST", env);
  if (host !== host.trim() || host.includes("://") || host.includes("/") || host.includes(":") || !host.endsWith(".neon.tech") || host.includes("pooler")) fail("STAGING_NEON_HOST must be the exact direct Neon hostname");
  const direct = databaseUrl("DIRECT_DATABASE_URL", required("DIRECT_DATABASE_URL", env), host);
  const runtime = databaseUrl("DATABASE_URL", required("DATABASE_URL", env), host);
  if (direct.hostname !== runtime.hostname || direct.pathname !== runtime.pathname || direct.username !== runtime.username) fail("DATABASE_URL and DIRECT_DATABASE_URL must target the same database and role");
  return direct;
}
export function verifyHyperdriveMetadata(drive, id, directUrl, expectedHost) {
  if (!/^[a-f0-9]{32}$/i.test(id) || /^0{32}$/.test(id)) fail("HYPERDRIVE_FRESH_ID is not provisioned");
  if (drive.id !== id) fail("Cloudflare did not confirm the requested Hyperdrive configuration");
  if (drive.name !== expected.hyperdriveName) fail("Hyperdrive name does not match the isolated Staging resource");
  const origin = drive.origin ?? {};
  if (origin.database !== expected.databaseName || origin.user !== expected.databaseRole || origin.host !== expectedHost || origin.host !== directUrl.hostname) fail("Hyperdrive origin does not match verified Neon host/database/role");
  if (!["postgres", "postgresql"].includes(String(origin.scheme).toLowerCase()) || Number(origin.port) !== 5432) fail("Hyperdrive must use PostgreSQL on port 5432");
  if (drive.caching?.disabled !== true) fail("Hyperdrive query caching must be verified disabled");
  if (drive.mtls?.sslmode !== undefined && !["require", "verify-ca", "verify-full"].includes(drive.mtls.sslmode)) fail("Hyperdrive TLS must not be disabled");
  return true;
}
async function verifyHyperdrive(directUrl) {
  if (required("CLOUDFLARE_ACCOUNT_ID") !== expected.cloudflareAccountId) fail("Cloudflare account does not match the approved Staging account");
  const id = required("HYPERDRIVE_FRESH_ID");
  if (!/^[a-f0-9]{32}$/.test(id) || /^0{32}$/.test(id)) fail("HYPERDRIVE_FRESH_ID is not a provisioned configuration ID");
  const token = required("CLOUDFLARE_API_TOKEN");
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${expected.cloudflareAccountId}/hyperdrive/configs/${id}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) fail(`Cloudflare Hyperdrive metadata check failed (HTTP ${response.status})`);
  const body = await response.json();
  if (body.success !== true || body.result?.id !== id) fail("Cloudflare did not confirm the requested Hyperdrive configuration");
  const drive = body.result;
  verifyHyperdriveMetadata(drive, id, directUrl, required("STAGING_NEON_HOST"));
  console.info("Verified isolated Neon database and cache-disabled Hyperdrive metadata.");
  return id;
}
export function buildStagingArtifacts(sourceConfig, env, driveId) {
  const direct = assertStagingSettings(env);
  const config = structuredClone(sourceConfig);
  if (config.name !== "bke-digital-solutions") fail("Unexpected Worker name");
  if (config.route || config.routes) fail("Custom routes are forbidden for workers.dev-only Staging");
  if (config.env) fail("Wrangler named environments cannot override the Staging target");
  config.workers_dev = true;
  const bindings = config.hyperdrive;
  if (!Array.isArray(bindings) || bindings.length !== 1 || bindings[0].binding !== "HYPERDRIVE_FRESH") fail("Unexpected Hyperdrive binding contract");
  bindings[0].id = driveId;
  delete bindings[0].localConnectionString;
  if (config.triggers?.crons?.length) fail("Scheduled Cron is disabled for this Staging deployment");
  const vars = Object.fromEntries(publicVariables
    .filter((name) => env[name] !== undefined && env[name] !== "")
    .map((name) => [name, env[name]]));
  Object.assign(vars, { NODE_ENV: "production", BKE_RUNTIME: "workers" });
  const forbidden = ["DATABASE_URL", "DIRECT_DATABASE_URL", "STAGING_NEON_HOST", "HYPERDRIVE_FRESH_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "INFISICAL_STAGING_IDENTITY_ID"];
  if (Object.keys(config.vars ?? {}).some((name) => forbidden.includes(name))) fail("Wrangler config contains forbidden Staging credential variables");
  config.vars = vars;
  const secrets = Object.fromEntries([...requiredSecrets, ...optionalSecrets]
    .filter((name) => env[name] !== undefined && env[name] !== "")
    .map((name) => [name, env[name]]));
  const missing = requiredSecrets.filter((name) => !secrets[name]);
  if (missing.length) fail(`Missing required Staging runtime secrets: ${missing.join(", ")}`);
  if (env.REDIS_URL) {
    if (!env.REDIS_URL.startsWith("rediss://")) fail("Staging REDIS_URL must use TLS");
  } else if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    fail("Staging requires a complete distributed Redis configuration");
  } else {
    let upstashUrl;
    try { upstashUrl = new URL(env.UPSTASH_REDIS_REST_URL); } catch { fail("UPSTASH_REDIS_REST_URL must be a valid HTTPS URL"); }
    if (upstashUrl.protocol !== "https:") fail("UPSTASH_REDIS_REST_URL must use HTTPS");
  }
  if (Object.hasOwn(secrets, "CLOUDFLARE_API_TOKEN") || Object.hasOwn(secrets, "INFISICAL_STAGING_IDENTITY_ID")) {
    fail("Deployment credentials must never enter the Worker runtime allowlist");
  }
  if (Object.keys(secrets).length > 100) fail("Runtime secret allowlist exceeds Cloudflare's bulk limit");
  return { config, secrets, direct };
}
export async function prepare(driveId) {
  const source = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
  const artifacts = buildStagingArtifacts(source, process.env, driveId);
  await writeFile(configPath, JSON.stringify(artifacts.config, null, 2) + "\n", { mode: 0o600 });
  await writeFile(secretsPath, JSON.stringify(artifacts.secrets, null, 2) + "\n", { mode: 0o600 });
  console.info(`Prepared Staging Worker configuration with ${Object.keys(artifacts.secrets).length} allowlisted runtime secrets.`);
}
async function main() {
  const command = process.argv[2];
  if (command === "verify") {
    const direct = assertStagingSettings();
    await verifyHyperdrive(direct);
  } else if (command === "prepare") {
    const direct = assertStagingSettings();
    const id = required("HYPERDRIVE_FRESH_ID");
    await prepare(id);
    void direct;
  } else if (command === "cleanup") {
    await Promise.all([rm(configPath, { force: true }), rm(secretsPath, { force: true })]);
  } else {
    fail("Usage: node scripts/deploy-staging.mjs <verify|prepare|cleanup>");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Staging operation failed");
    process.exitCode = 1;
  });
}

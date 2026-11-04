import { readFile, writeFile, rm } from "node:fs/promises";

const expected = {
  appUrl: "https://bke-digital-solutions.jlprojectfreedom.workers.dev",
  deploymentEnv: "staging",
  databaseName: "bke_staging",
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
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
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
  "S3_ENDPOINT",
  "S3_PUBLIC_UPLOAD_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_FORCE_PATH_STYLE",
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
function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) fail(`Missing required Staging setting: ${name}`);
  return value;
}
function databaseUrl(name) {
  let url;
  try {
    url = new URL(required(name));
  } catch {
    fail(`${name} must be a valid PostgreSQL URL`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) fail(`${name} must use PostgreSQL`);
  if (decodeURIComponent(url.pathname.slice(1)) !== expected.databaseName) fail(`${name} must target the isolated Staging database`);
  if (!url.hostname.endsWith(".neon.tech")) fail(`${name} must target the verified Neon Staging host`);
  return url;
}
function assertStagingSettings() {
  if (required("APP_URL") !== expected.appUrl) fail("Staging APP_URL does not match the approved Cloudflare-owned origin");
  if (required("DEPLOYMENT_ENV") !== expected.deploymentEnv) fail("DEPLOYMENT_ENV must be staging");
  if (!required("DEPLOYMENT_ID").includes("staging")) fail("DEPLOYMENT_ID must identify the isolated Staging deployment");
  if (required("PAYMENT_PROVIDER") !== "mock") fail("Initial Staging requires mock payments");
  if (required("EMAIL_PROVIDER") !== "log") fail("Initial Staging requires log-only email");
  if (required("PAYMONGO_LIVEMODE") !== "false") fail("PAYMONGO_LIVEMODE must explicitly be false");
  for (const name of ["LOCAL_PRODUCTION_SIMULATION", "ALLOW_BREAK_GLASS", "ALLOW_DESTRUCTIVE_ADMIN", "BACKUP_ENABLED", "CLAIM_CODE_CHECKOUT_ENABLED", "AGENT_ACCOUNT_SESSION_ENABLED"]) {
    if (process.env[name] === "true") fail(`${name} must remain disabled for isolated authentication Staging`);
  }
  required("GOOGLE_CLIENT_ID");
  required("GOOGLE_CLIENT_SECRET");
  const direct = databaseUrl(process.env.DIRECT_DATABASE_URL ? "DIRECT_DATABASE_URL" : "DATABASE_URL");
  if (process.env.DATABASE_URL) databaseUrl("DATABASE_URL");
  return direct;
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
  if (drive.name !== expected.hyperdriveName) fail("Hyperdrive name does not match the isolated Staging resource");
  if (drive.origin?.database !== expected.databaseName || drive.origin?.host !== directUrl.hostname) fail("Hyperdrive origin does not match the isolated Neon Staging database");
  if (drive.caching?.disabled !== true) fail("Hyperdrive query caching must be verified disabled");
  console.info("Verified isolated Neon database and cache-disabled Hyperdrive metadata.");
  return id;
}
async function prepare(driveId) {
  const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
  if (config.name !== "bke-digital-solutions") fail("Unexpected Worker name");
  const bindings = config.hyperdrive;
  if (!Array.isArray(bindings) || bindings.length !== 1 || bindings[0].binding !== "HYPERDRIVE_FRESH") fail("Unexpected Hyperdrive binding contract");
  bindings[0].id = driveId;
  delete bindings[0].localConnectionString;
  if (config.triggers?.crons?.length) fail("Scheduled Cron is disabled for this Staging deployment");
  const vars = Object.fromEntries(publicVariables
    .filter((name) => process.env[name] !== undefined && process.env[name] !== "")
    .map((name) => [name, process.env[name]]));
  Object.assign(vars, {
    NODE_ENV: "production",
    BKE_RUNTIME: "workers",
    // The Worker obtains its only database connection from HYPERDRIVE_FRESH per operation.
    // This inert URL satisfies import-time configuration shape without exposing Neon credentials.
  });
  config.vars = { ...config.vars, ...vars };
  const secrets = Object.fromEntries([...requiredSecrets, ...optionalSecrets]
    .filter((name) => process.env[name] !== undefined && process.env[name] !== "")
    .map((name) => [name, process.env[name]]));
  const missing = requiredSecrets.filter((name) => !secrets[name]);
  if (missing.length) fail(`Missing required Staging runtime secrets: ${missing.join(", ")}`);
  if (process.env.REDIS_URL) {
    if (!process.env.REDIS_URL.startsWith("rediss://")) fail("Staging REDIS_URL must use TLS");
  } else if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    fail("Staging requires a complete distributed Redis configuration");
  }
  if (Object.hasOwn(secrets, "CLOUDFLARE_API_TOKEN") || Object.hasOwn(secrets, "INFISICAL_STAGING_IDENTITY_ID")) {
    fail("Deployment credentials must never enter the Worker runtime allowlist");
  }
  if (Object.keys(secrets).length > 100) fail("Runtime secret allowlist exceeds Cloudflare's bulk limit");
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await writeFile(secretsPath, JSON.stringify(secrets, null, 2) + "\n", { mode: 0o600 });
  console.info(`Prepared Staging Worker configuration with ${Object.keys(secrets).length} allowlisted runtime secrets.`);
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
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Staging operation failed");
  process.exitCode = 1;
});

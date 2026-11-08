import { readFile, writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const LIVE_ORIGIN = "https://bkedigitalsolutions.com";
export const LIVE_WORKER = "bke-digital-solutions";
export const LIVE_ACCOUNT = "384c6c13373eb94a2925e0d865139970";
const productionDatabase = "bke_production";
const productionRole = "bke_production_owner";
const targetConfig = ".wrangler-live.json";
const targetSecrets = ".wrangler-live-secrets.json";
const requireSecret = [
  "GOOGLE_CLIENT_SECRET", "SESSION_SECRET", "CRON_SECRET", "LICENSE_PEPPER",
  "LICENSE_SIGNING_PRIVATE_KEY", "LICENSE_SIGNING_PUBLIC_KEY",
  "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET",
];
const optionalSecrets = [
  "REDIS_URL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
  "RESEND_API_KEY", "CLAIM_CODE_ENCRYPTION_KEY",
  "AGENT_ACCOUNT_SESSION_PEPPER", "AGENT_ACCOUNT_SESSION_ENCRYPTION_KEY",
  "PROVIDER_CREDENTIALS_ENCRYPTION_KEY", "BACKUP_S3_ACCESS_KEY_ID",
  "BACKUP_S3_SECRET_ACCESS_KEY", "BACKUP_ENCRYPTION_KEY",
];
const publicVariables = [
  "APP_URL", "DEPLOYMENT_ENV", "DEPLOYMENT_ID", "GOOGLE_CLIENT_ID",
  "PAYMENT_PROVIDER", "PAYMONGO_LIVEMODE", "PROVIDER_CONFIG_SOURCE",
  "PROVIDER_CONFIG_ALLOW_ENV_FALLBACK", "EMAIL_PROVIDER", "EMAIL_FROM",
  "REDIS_KEY_PREFIX", "SUPPORT_EMAIL", "TRUSTED_ORIGINS", "TRUST_PROXY_HOPS",
  "CLAIM_CODE_CHECKOUT_ENABLED", "AGENT_ACCOUNT_SESSION_ENABLED", "ALLOW_BREAK_GLASS",
  "ALLOW_DESTRUCTIVE_ADMIN", "PROVIDER_CREDENTIALS_KEY_VERSION",
  "LICENSE_SIGNING_KEY_ID", "BACKUP_ENABLED", "BACKUP_S3_ENDPOINT",
  "BACKUP_S3_REGION", "BACKUP_BUCKET", "BACKUP_S3_FORCE_PATH_STYLE", "BACKUP_OFFSITE_ACK",
  "BACKUP_ENCRYPTION_KEY_VERSION", "BACKUP_RETENTION_DAILY",
  "BACKUP_RETENTION_WEEKLY", "BACKUP_RETENTION_MONTHLY", "BACKUP_WORKER_POLL_SECONDS",
];

function fail(code) { throw new Error(code); }
function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || !value.trim()) fail("LIVE_REQUIRED_" + name);
  return value.trim();
}
function pgUrl(value, host) {
  let parsed;
  try { parsed = new URL(value); } catch { fail("LIVE_DATABASE_URL_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) fail("LIVE_DATABASE_PROTOCOL");
  const keys = new Set();
  for (const [raw] of parsed.searchParams) {
    const key = raw.toLowerCase();
    if (keys.has(key) || ["host","hostaddr","username","user","port","password","database","dbname","service"].includes(key)) fail("LIVE_DATABASE_QUERY_OVERRIDE");
    keys.add(key);
  }
  if (parsed.hostname !== host || !host.endsWith(".neon.tech") || host.includes("pooler")) fail("LIVE_DATABASE_HOST");
  if (decodeURIComponent(parsed.pathname.slice(1)) !== productionDatabase) fail("LIVE_DATABASE_NAME");
  if (decodeURIComponent(parsed.username) !== productionRole) fail("LIVE_DATABASE_ROLE");
  if (parsed.port && parsed.port !== "5432") fail("LIVE_DATABASE_PORT");
  if (!["require","verify-ca","verify-full"].includes(parsed.searchParams.get("sslmode"))) fail("LIVE_DATABASE_TLS");
  return parsed;
}

// Schema bootstrap is a separate protected intent from commercial activation.
// It validates only the destination/trust needed for reviewed Prisma migrations.
export function assertProductionSchemaSettings(env = process.env) {
  if (required(env, "APP_URL") !== LIVE_ORIGIN) fail("LIVE_APP_ORIGIN");
  if (required(env, "DEPLOYMENT_ENV") !== "production") fail("LIVE_DEPLOYMENT_ENV");
  const host = required(env, "PRODUCTION_NEON_HOST");
  if (host.includes("://") || host.includes(":") || host.includes("/") || host.includes("pooler")) fail("LIVE_NEON_HOST");
  const direct = pgUrl(required(env, "DIRECT_DATABASE_URL"), host);
  const runtime = pgUrl(required(env, "DATABASE_URL"), host);
  if (direct.href !== runtime.href) fail("LIVE_DATABASE_CREDENTIAL_MISMATCH");
  if (env.HYPERDRIVE_FRESH_ID || env.STAGING_NEON_HOST) fail("LIVE_STAGING_RESOURCE_INJECTION");
  return direct;
}

export function assertLiveSettings(env = process.env) {
  if (required(env, "APP_URL") !== LIVE_ORIGIN) fail("LIVE_APP_ORIGIN");
  if (required(env, "DEPLOYMENT_ENV") !== "production") fail("LIVE_DEPLOYMENT_ENV");
  const id = required(env, "DEPLOYMENT_ID");
  const prefix = required(env, "REDIS_KEY_PREFIX");
  if (!/^[a-z0-9-]{3,31}$/.test(id) || /staging|test|try/.test(id)) fail("LIVE_DEPLOYMENT_ID");
  if (!prefix.includes(id) || /staging|test|try/.test(prefix)) fail("LIVE_REDIS_NAMESPACE");
  if (required(env, "PAYMENT_PROVIDER") !== "paymongo" || required(env, "PAYMONGO_LIVEMODE") !== "true") fail("LIVE_PAYMONGO_PROVIDER");
  if ((env.PROVIDER_CONFIG_SOURCE || "environment") !== "environment" ||
      env.PROVIDER_CONFIG_ALLOW_ENV_FALLBACK === "true") fail("LIVE_PROVIDER_SOURCE");
  const secret = required(env, "PAYMONGO_SECRET_KEY");
  const webhook = required(env, "PAYMONGO_WEBHOOK_SECRET");
  if (!/^sk_live_[A-Za-z0-9_-]{12,}$/.test(secret)) fail("LIVE_PAYMONGO_KEY_MODE");
  if (webhook.length < 16 || webhook === secret) fail("LIVE_PAYMONGO_WEBHOOK_SECRET");
  if (required(env, "EMAIL_PROVIDER") === "log") fail("LIVE_EMAIL_PROVIDER");
  if (env.EMAIL_PROVIDER === "resend") required(env, "RESEND_API_KEY");
  if (!["resend", "cloudflare"].includes(env.EMAIL_PROVIDER)) fail("LIVE_EMAIL_PROVIDER");
  if (env.LOCAL_PRODUCTION_SIMULATION === "true" || env.ALLOW_BREAK_GLASS === "true" ||
      env.ALLOW_DESTRUCTIVE_ADMIN === "true") fail("LIVE_PRIVILEGED_MODE");
  if (required(env, "BACKUP_ENABLED") !== "true" ||
      required(env, "BACKUP_OFFSITE_ACK") !== "SEPARATE_FAILURE_DOMAIN") fail("LIVE_BACKUP_REQUIRED");
  for (const name of ["BACKUP_BUCKET","BACKUP_ENCRYPTION_KEY","BACKUP_S3_ACCESS_KEY_ID","BACKUP_S3_SECRET_ACCESS_KEY"]) required(env,name);
  const host = required(env, "PRODUCTION_NEON_HOST");
  if (host.includes("://") || host.includes(":") || host.includes("/") || host.includes("pooler")) fail("LIVE_NEON_HOST");
  const direct = pgUrl(required(env, "DIRECT_DATABASE_URL"),host);
  const runtime = pgUrl(required(env, "DATABASE_URL"),host);
  if (direct.href !== runtime.href) fail("LIVE_DATABASE_CREDENTIAL_MISMATCH");
  if (env.HYPERDRIVE_FRESH_ID || env.STAGING_NEON_HOST) fail("LIVE_STAGING_RESOURCE_INJECTION");
  for (const name of requireSecret) required(env,name);
  if (env.REDIS_URL) {
    if (!env.REDIS_URL.startsWith("rediss://")) fail("LIVE_REDIS_TLS");
  } else if (!env.UPSTASH_REDIS_REST_URL?.startsWith("https://") || !env.UPSTASH_REDIS_REST_TOKEN) fail("LIVE_REDIS_REQUIRED");
  return direct;
}

export function verifyLiveHyperdrive(drive, id, direct, env = process.env) {
  if (!/^[a-f0-9]{32}$/i.test(id) || /^0{32}$/.test(id)) fail("LIVE_HYPERDRIVE_ID");
  if (drive.id !== id || drive.name !== "bke-digital-solutions-production") fail("LIVE_HYPERDRIVE_NAME");
  const origin = drive.origin || {};
  if (origin.database !== productionDatabase || origin.user !== productionRole ||
    origin.host !== direct.hostname || origin.host !== required(env,"PRODUCTION_NEON_HOST") ||
    !["postgres","postgresql"].includes(String(origin.scheme).toLowerCase()) ||
    Number(origin.port) !== 5432) fail("LIVE_HYPERDRIVE_DATABASE");
  if (drive.caching?.disabled !== true ||
    !["require","verify-ca","verify-full"].includes(drive.mtls?.sslmode)) fail("LIVE_HYPERDRIVE_TRUST");
  return true;
}

export function buildLiveArtifacts(source, env = process.env, hyperdriveId) {
  const direct = assertLiveSettings(env);
  const config = structuredClone(source);
  if (config.name !== LIVE_WORKER || config.route || config.routes || config.env ||
      !config.observability?.enabled || config.observability?.redact_query_string !== true) fail("LIVE_WRANGLER_CONFIG");
  if (!Array.isArray(config.hyperdrive) || config.hyperdrive.length !== 1 ||
      config.hyperdrive[0].binding !== "HYPERDRIVE_FRESH") fail("LIVE_HYPERDRIVE_BINDING");
  if (!/^[a-f0-9]{32}$/i.test(hyperdriveId) || /^0{32}$/.test(hyperdriveId)) fail("LIVE_HYPERDRIVE_ID");
  if (config.triggers?.crons?.length) fail("LIVE_UNREVIEWED_CRONS");
  config.hyperdrive[0].id=hyperdriveId;
  delete config.hyperdrive[0].localConnectionString;
  config.workers_dev=false;
  config.routes=[{pattern:"bkedigitalsolutions.com",custom_domain:true}];
  if (Object.keys(config.vars || {}).some(n=>n!=="BKE_RUNTIME")) fail("LIVE_INHERITED_VARIABLE");
  config.vars={...Object.fromEntries(publicVariables.filter(n=>env[n]).map(n=>[n,env[n]])),NODE_ENV:"production",BKE_RUNTIME:"workers",PROVIDER_CONFIG_SOURCE:"environment",PROVIDER_CONFIG_ALLOW_ENV_FALLBACK:"false"};
  const secrets=Object.fromEntries([...requireSecret,...optionalSecrets].filter(n=>env[n]).map(n=>[n,env[n]]));
  if (Object.keys(secrets).length > 100) fail("LIVE_TOO_MANY_SECRETS");
  return {config,secrets,direct};
}

async function verifyRemoteDrive(env, schemaOnly = false) {
  const direct = schemaOnly ? assertProductionSchemaSettings(env) : assertLiveSettings(env);
  if (required(env,"CLOUDFLARE_ACCOUNT_ID") !== LIVE_ACCOUNT) fail("LIVE_CLOUDFLARE_ACCOUNT");
  const id=required(env,"HYPERDRIVE_ID");
  const token=required(env,"CLOUDFLARE_API_TOKEN");
  const response=await fetch("https://api.cloudflare.com/client/v4/accounts/"+LIVE_ACCOUNT+"/hyperdrive/configs/"+id,{
    headers:{authorization:"Bearer "+token,accept:"application/json"},signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) fail("LIVE_HYPERDRIVE_VERIFICATION_FAILED");
  const body=await response.json();
  if (body.success!==true) fail("LIVE_HYPERDRIVE_VERIFICATION_FAILED");
  verifyLiveHyperdrive(body.result,id,direct,env);
}
async function main() {
  const action=process.argv[2];
  if (action==="validate_schema") {assertProductionSchemaSettings();console.info("PASS: production schema target validated (no provider call, no charge).");}
  else if (action==="verify_schema") {await verifyRemoteDrive(process.env, true);console.info("PASS: production schema Hyperdrive verified (read-only).");}
  else if (action==="validate") {assertLiveSettings();console.info("PASS: isolated live PayMongo configuration validated (no provider call, no charge).");}
  else if (action==="verify") {await verifyRemoteDrive(process.env);console.info("PASS: production-only Hyperdrive verified.");}
  else if (action==="prepare") {
    const source=JSON.parse(await readFile("wrangler.jsonc","utf8"));
    const generated=buildLiveArtifacts(source,process.env,required(process.env,"HYPERDRIVE_ID"));
    await writeFile(targetConfig,JSON.stringify(generated.config,null,2)+"\n",{mode:0o600});
    await writeFile(targetSecrets,JSON.stringify(generated.secrets,null,2)+"\n",{mode:0o600});
    console.info("Prepared protected production Worker deployment artifacts.");
  } else if (action==="cleanup") {await Promise.all([rm(targetConfig,{force:true}),rm(targetSecrets,{force:true})]);}
  else fail("LIVE_COMMAND_INVALID");
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(e=>{console.error(e instanceof Error && /^LIVE_[A-Z_]+$/.test(e.message)?e.message:"LIVE_PREPARATION_FAILED");process.exitCode=1;});
}

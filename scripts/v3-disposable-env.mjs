import {
  X509Certificate,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(SCRIPT_DIR, "..");

const REQUIRED_SECRETS = [
  "SESSION_SECRET",
  "MFA_ENCRYPTION_KEY",
  "LICENSE_PEPPER",
  "CLAIM_CODE_ENCRYPTION_KEY",
  "AGENT_ACCOUNT_SESSION_PEPPER",
  "AGENT_ACCOUNT_SESSION_ENCRYPTION_KEY",
  "ADMIN_OWNER_RECOVERY_KEY",
  "PROVIDER_CREDENTIALS_ENCRYPTION_KEY",
  "CRON_SECRET",
  "RELEASE_EVIDENCE_INGESTION_TOKEN",
  "POSTGRES_PASSWORD",
  "MINIO_ROOT_PASSWORD",
  "S3_SECRET_ACCESS_KEY",
  "BACKUP_ENCRYPTION_KEY",
];

export function parseSimpleEnv(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("DISPOSABLE_SECRETS_ENV_INVALID");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    values[key] = value;
  }
  return values;
}

function requireSecret(secrets, key) {
  const value = secrets[key]?.trim();
  if (!value) throw new Error(`DISPOSABLE_SECRET_MISSING:${key}`);
  return value;
}

function encodedPem(path) {
  return Buffer.from(readFileSync(path, "utf8"), "utf8").toString("base64");
}

function assertEd25519Pair(privatePath, publicPath, label) {
  const privateKey = createPrivateKey(readFileSync(privatePath, "utf8"));
  const publicKey = createPublicKey(readFileSync(publicPath, "utf8"));
  if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error(`${label}_KEY_TYPE_INVALID`);
  }
  const derived = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const configured = publicKey.export({ format: "der", type: "spki" });
  if (!Buffer.from(derived).equals(Buffer.from(configured))) {
    throw new Error(`${label}_KEYPAIR_MISMATCH`);
  }
}

function assertTlsBundle(bundleDir) {
  const certPath = join(bundleDir, "tls", "bke-v3.test.crt.pem");
  const keyPath = join(bundleDir, "tls", "bke-v3.test.key.pem");
  const caPath = join(bundleDir, "tls", "bke-v3-disposable-ca.crt.pem");
  for (const path of [certPath, keyPath, caPath]) {
    if (!existsSync(path)) throw new Error(`DISPOSABLE_TLS_FILE_MISSING:${path}`);
  }

  const certificate = new X509Certificate(readFileSync(certPath));
  if (!certificate.checkHost("bke-v3.test")) throw new Error("DISPOSABLE_TLS_HOSTNAME_INVALID");

  const privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));
  const derived = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const configured = certificate.publicKey.export({ format: "der", type: "spki" });
  if (!Buffer.from(derived).equals(Buffer.from(configured))) {
    throw new Error("DISPOSABLE_TLS_KEYPAIR_MISMATCH");
  }

  const ca = new X509Certificate(readFileSync(caPath));
  if (typeof certificate.verify === "function" && !certificate.verify(ca.publicKey)) {
    throw new Error("DISPOSABLE_TLS_CA_MISMATCH");
  }
}

export function renderDisposableEnvironment({
  secrets,
  licensePrivateBase64,
  licensePublicBase64,
  supplyPrivateBase64,
  supplyPublicBase64,
}) {
  for (const key of REQUIRED_SECRETS) requireSecret(secrets, key);

  const supplyKeyId = "bke-v3-disposable-supply-chain-ed25519-v1";
  const trustedSupplyKeys = JSON.stringify({ [supplyKeyId]: supplyPublicBase64 });

  const values = [
    ["BKE_DISPOSABLE_CERTIFICATION", "true"],
    ["NODE_ENV", "production"],
    ["DEPLOYMENT_ENV", "test"],
    ["DEPLOYMENT_ID", "bke-v3-disposable"],
    ["APP_URL", "https://bke-v3.test:8443"],
    ["INTERNAL_APP_URL", "http://app:3000"],
    ["PUBLIC_WEBHOOK_ORIGIN", ""],
    ["LOCAL_PRODUCTION_SIMULATION", "false"],
    ["APP_DOMAIN", "bke-v3.test"],
    ["S3_UPLOAD_DOMAIN", "uploads.bke-v3.test"],
    ["ACME_EMAIL", "dev@bke-v3.test"],
    ["TRUSTED_ORIGINS", "https://bke-v3.test:8443"],
    ["TRUST_PROXY_HOPS", "1"],
    ["DATABASE_URL", `postgresql://bke_v3:${requireSecret(secrets, "POSTGRES_PASSWORD")}@postgres:5432/bke_v3?schema=public`],
    ["DIRECT_DATABASE_URL", `postgresql://bke_v3:${requireSecret(secrets, "POSTGRES_PASSWORD")}@postgres:5432/bke_v3?schema=public`],
    ["POSTGRES_DB", "bke_v3"],
    ["POSTGRES_USER", "bke_v3"],
    ["POSTGRES_PASSWORD", requireSecret(secrets, "POSTGRES_PASSWORD")],
    ["SESSION_SECRET", requireSecret(secrets, "SESSION_SECRET")],
    ["MFA_ENCRYPTION_KEY", requireSecret(secrets, "MFA_ENCRYPTION_KEY")],
    ["LICENSE_PEPPER", requireSecret(secrets, "LICENSE_PEPPER")],
    ["CLAIM_CODE_CHECKOUT_ENABLED", "false"],
    ["CLAIM_CODE_ENCRYPTION_KEY", requireSecret(secrets, "CLAIM_CODE_ENCRYPTION_KEY")],
    ["AGENT_ACCOUNT_SESSION_ENABLED", "true"],
    ["AGENT_ACCOUNT_SESSION_PEPPER", requireSecret(secrets, "AGENT_ACCOUNT_SESSION_PEPPER")],
    ["AGENT_ACCOUNT_SESSION_ENCRYPTION_KEY", requireSecret(secrets, "AGENT_ACCOUNT_SESSION_ENCRYPTION_KEY")],
    ["LICENSE_SIGNING_KEY_ID", "bke-v3-disposable-ed25519-v1"],
    ["LICENSE_SIGNING_PRIVATE_KEY", licensePrivateBase64],
    ["LICENSE_SIGNING_PUBLIC_KEY", licensePublicBase64],
    ["SUPPLY_CHAIN_SIGNING_KEY_ID", supplyKeyId],
    ["SUPPLY_CHAIN_SIGNING_PRIVATE_KEY", supplyPrivateBase64],
    ["SUPPLY_CHAIN_SIGNING_PUBLIC_KEY", supplyPublicBase64],
    ["SUPPLY_CHAIN_TRUSTED_KEYS", trustedSupplyKeys],
    ["RELEASE_EVIDENCE_INGESTION_TOKEN", requireSecret(secrets, "RELEASE_EVIDENCE_INGESTION_TOKEN")],
    ["ALLOW_BREAK_GLASS", "false"],
    ["ADMIN_OWNER_RECOVERY_KEY", requireSecret(secrets, "ADMIN_OWNER_RECOVERY_KEY")],
    ["ADMIN_OWNER_RECOVERY_KEY_VERSION", "1"],
    ["MALWARE_SCANNER_PROVIDER", ""],
    ["MALWARE_SCANNER_VERSION", ""],
    ["MALWARE_SCANNER_HOST", ""],
    ["MALWARE_SCANNER_PORT", "3310"],
    ["MALWARE_SCANNER_TIMEOUT_MS", "30000"],
    ["MALWARE_SCANNER_MAX_BYTES", "536870912"],
    ["PROVIDER_CREDENTIALS_ENCRYPTION_KEY", requireSecret(secrets, "PROVIDER_CREDENTIALS_ENCRYPTION_KEY")],
    ["PROVIDER_CREDENTIALS_KEY_VERSION", "1"],
    ["PROVIDER_CREDENTIALS_PREVIOUS_KEYS", ""],
    ["PROVIDER_CONFIG_SOURCE", "environment"],
    ["PROVIDER_CONFIG_ALLOW_ENV_FALLBACK", "false"],
    ["PAYMENT_PROVIDER", "mock"],
    ["PAYMONGO_SECRET_KEY", ""],
    ["PAYMONGO_WEBHOOK_SECRET", ""],
    ["PAYMONGO_LIVEMODE", "false"],
    ["EMAIL_PROVIDER", "log"],
    ["RESEND_API_KEY", ""],
    ["RESEND_SANDBOX_TO", ""],
    ["BKE_DISABLE_EXTERNAL_EMAIL", "true"],
    ["EMAIL_FROM", "BKE V3 Disposable <no-reply@bke-v3.test>"],
    ["SUPPORT_EMAIL", "support@bke-v3.test"],
    ["BUSINESS_ADDRESS", "Disposable local V3 certification environment"],
    ["REDIS_URL", "redis://valkey:6379"],
    ["REDIS_KEY_PREFIX", "bke-v3-disposable"],
    ["UPSTASH_REDIS_REST_URL", ""],
    ["UPSTASH_REDIS_REST_TOKEN", ""],
    ["S3_ENDPOINT", "http://minio:9000"],
    ["S3_PUBLIC_UPLOAD_ENDPOINT", ""],
    ["S3_REGION", "auto"],
    ["S3_BUCKET", "bke-v3-disposable-private"],
    ["S3_ACCESS_KEY_ID", "bke-v3-disposable"],
    ["S3_SECRET_ACCESS_KEY", requireSecret(secrets, "S3_SECRET_ACCESS_KEY")],
    ["S3_FORCE_PATH_STYLE", "true"],
    ["MAX_ARTIFACT_BYTES", "536870912"],
    ["MINIO_ROOT_USER", "bke-v3-root"],
    ["MINIO_ROOT_PASSWORD", requireSecret(secrets, "MINIO_ROOT_PASSWORD")],
    ["CRON_SECRET", requireSecret(secrets, "CRON_SECRET")],
    ["SEED_DEMO_DATA", "false"],
    ["LOG_LEVEL", "debug"],
    ["ALLOW_DESTRUCTIVE_ADMIN", "false"],
    ["MONITORING_DSN", ""],
    ["BACKUP_ENABLED", "false"],
    ["BACKUP_S3_ENDPOINT", "http://minio:9000"],
    ["BACKUP_S3_REGION", "auto"],
    ["BACKUP_BUCKET", "bke-v3-disposable-backups"],
    ["BACKUP_S3_ACCESS_KEY_ID", "bke-v3-disposable"],
    ["BACKUP_S3_SECRET_ACCESS_KEY", requireSecret(secrets, "S3_SECRET_ACCESS_KEY")],
    ["BACKUP_S3_FORCE_PATH_STYLE", "true"],
    ["BACKUP_ENCRYPTION_KEY", requireSecret(secrets, "BACKUP_ENCRYPTION_KEY")],
    ["BACKUP_ENCRYPTION_KEY_VERSION", "1"],
    ["BACKUP_RETENTION_DAILY", "7"],
    ["BACKUP_RETENTION_WEEKLY", "4"],
    ["BACKUP_RETENTION_MONTHLY", "12"],
    ["BACKUP_WORKER_POLL_SECONDS", "10"],
    ["BACKUP_RESTORE_DATABASE_URL", ""],
    ["BACKUP_RESTORE_S3_BUCKET", "bke-v3-disposable-restore"],
    ["BACKUP_RESTORE_ACK", ""],
    ["BACKUP_OFFSITE_ACK", ""],
  ];

  return values.map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
}

export function materializeDisposableEnvironment({
  rootDir = ROOT_DIR,
  bundleDir = process.env.BKE_DISPOSABLE_DIR
    ? resolve(process.env.BKE_DISPOSABLE_DIR)
    : join(rootDir, ".bke-disposable"),
  target = join(rootDir, ".env.certification"),
} = {}) {
  const secretPath = join(bundleDir, "secrets.env");
  if (!existsSync(secretPath)) throw new Error(`DISPOSABLE_BUNDLE_MISSING:${secretPath}`);

  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (existing && !existing.includes("BKE_DISPOSABLE_CERTIFICATION=true")) {
    throw new Error("REFUSING_TO_OVERWRITE_NON_DISPOSABLE_CERTIFICATION_ENV");
  }

  const secrets = parseSimpleEnv(readFileSync(secretPath, "utf8"));
  for (const key of REQUIRED_SECRETS) requireSecret(secrets, key);

  const signingDir = join(bundleDir, "signing");
  const licensePrivatePath = join(signingDir, "license-signing-private.pem");
  const licensePublicPath = join(signingDir, "license-signing-public.pem");
  const supplyPrivatePath = join(signingDir, "supply-chain-signing-private.pem");
  const supplyPublicPath = join(signingDir, "supply-chain-signing-public.pem");

  for (const path of [
    licensePrivatePath,
    licensePublicPath,
    supplyPrivatePath,
    supplyPublicPath,
  ]) {
    if (!existsSync(path)) throw new Error(`DISPOSABLE_SIGNING_FILE_MISSING:${path}`);
  }

  assertEd25519Pair(licensePrivatePath, licensePublicPath, "LICENSE_SIGNING");
  assertEd25519Pair(supplyPrivatePath, supplyPublicPath, "SUPPLY_CHAIN_SIGNING");
  assertTlsBundle(bundleDir);

  const environment = renderDisposableEnvironment({
    secrets,
    licensePrivateBase64: encodedPem(licensePrivatePath),
    licensePublicBase64: encodedPem(licensePublicPath),
    supplyPrivateBase64: encodedPem(supplyPrivatePath),
    supplyPublicBase64: encodedPem(supplyPublicPath),
  });

  writeFileSync(target, environment, { encoding: "utf8", mode: 0o600 });
  chmodSync(target, 0o600);
  return target;
}

function main() {
  const target = materializeDisposableEnvironment();
  console.info(`Disposable V3 certification environment materialized at ${target} (mode 0600).`);
  console.info("Provider mode: payment=mock, email=log. No live provider credentials were imported.");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

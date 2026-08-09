import { z } from "zod";

const optional = (value: unknown) => value === "" ? undefined : value;
const bool = z.enum(["true", "false"]).transform((value) => value === "true");
const placeholder = /(replace|change[-_ ]?me|example|placeholder|your[-_]|minioadmin|development-only)/i;
const secret = z.string().min(32);

export const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DEPLOYMENT_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  DEPLOYMENT_ID: z.string().regex(/^[a-z0-9][a-z0-9-]{1,30}$/).default("bke-development"),
  APP_URL: z.url(),
  INTERNAL_APP_URL: z.preprocess(optional, z.url().optional()),
  PUBLIC_WEBHOOK_ORIGIN: z.preprocess(optional, z.url().optional()),
  LOCAL_PRODUCTION_SIMULATION: bool.default(false),
  TRUSTED_ORIGINS: z.preprocess(optional, z.string().optional()),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  DATABASE_URL: z.string().min(1),
  DIRECT_DATABASE_URL: z.preprocess(optional, z.string().min(1).optional()),
  SESSION_SECRET: secret,
  MFA_ENCRYPTION_KEY: z.preprocess(optional, secret.optional()),
  LICENSE_PEPPER: secret,
  LICENSE_SIGNING_PRIVATE_KEY: z.preprocess(optional, z.string().min(64).optional()),
  LICENSE_SIGNING_PUBLIC_KEY: z.preprocess(optional, z.string().min(32).optional()),
  LICENSE_SIGNING_KEY_ID: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).default("development-ed25519-v1"),
  SUPPLY_CHAIN_SIGNING_PUBLIC_KEY: z.preprocess(optional, z.string().min(32).optional()),
  CRON_SECRET: secret,
  PROVIDER_CREDENTIALS_ENCRYPTION_KEY: z.preprocess(optional, secret.optional()),
  PROVIDER_CREDENTIALS_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  PROVIDER_CREDENTIALS_PREVIOUS_KEYS: z.preprocess(optional, z.string().optional()),
  PROVIDER_CONFIG_SOURCE: z.enum(["environment", "database"]).default("environment"),
  PROVIDER_CONFIG_ALLOW_ENV_FALLBACK: bool.default(false),
  REDIS_URL: z.preprocess(optional, z.url().optional()),
  REDIS_KEY_PREFIX: z.string().regex(/^[a-z0-9:-]+$/).default("bke-development"),
  UPSTASH_REDIS_REST_URL: z.preprocess(optional, z.url().optional()),
  UPSTASH_REDIS_REST_TOKEN: z.preprocess(optional, z.string().min(1).optional()),
  S3_ENDPOINT: z.preprocess(optional, z.url().optional()),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.preprocess(optional, z.string().min(1).optional()),
  S3_SECRET_ACCESS_KEY: z.preprocess(optional, z.string().min(1).optional()),
  S3_FORCE_PATH_STYLE: bool.default(true),
  MAX_ARTIFACT_BYTES: z.coerce.number().int().min(1_048_576).max(536_870_912).default(262_144_000),
  PAYMENT_PROVIDER: z.enum(["mock", "paymongo"]).default("mock"),
  PAYMONGO_SECRET_KEY: z.preprocess(optional, z.string().min(1).optional()),
  PAYMONGO_WEBHOOK_SECRET: z.preprocess(optional, z.string().min(1).optional()),
  PAYMONGO_LIVEMODE: bool.default(false),
  EMAIL_PROVIDER: z.enum(["log", "resend"]).default("log"),
  RESEND_API_KEY: z.preprocess(optional, z.string().min(1).optional()),
  EMAIL_FROM: z.string().min(3),
  SUPPORT_EMAIL: z.email().default("support@example.com"),
  BUSINESS_ADDRESS: z.string().trim().min(3).max(500).default("Business address to be supplied during legal review"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  ALLOW_DESTRUCTIVE_ADMIN: bool.default(false),
  MONITORING_DSN: z.preprocess(optional, z.url().optional()),
  BACKUP_ENABLED: bool.default(false),
  BACKUP_S3_ENDPOINT: z.preprocess(optional, z.url().optional()),
  BACKUP_S3_REGION: z.string().default("auto"),
  BACKUP_BUCKET: z.preprocess(optional, z.string().min(3).optional()),
  BACKUP_S3_ACCESS_KEY_ID: z.preprocess(optional, z.string().min(1).optional()),
  BACKUP_S3_SECRET_ACCESS_KEY: z.preprocess(optional, z.string().min(1).optional()),
  BACKUP_S3_FORCE_PATH_STYLE: bool.default(true),
  BACKUP_ENCRYPTION_KEY: z.preprocess(optional, z.string().min(32).optional()),
  BACKUP_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  BACKUP_RETENTION_DAILY: z.coerce.number().int().min(1).max(365).default(7),
  BACKUP_RETENTION_WEEKLY: z.coerce.number().int().min(1).max(104).default(4),
  BACKUP_RETENTION_MONTHLY: z.coerce.number().int().min(1).max(120).default(12),
  BACKUP_WORKER_POLL_SECONDS: z.coerce.number().int().min(2).max(300).default(10),
  BACKUP_RESTORE_DATABASE_URL: z.preprocess(optional, z.string().min(1).optional()),
  BACKUP_RESTORE_S3_BUCKET: z.preprocess(optional, z.string().min(3).optional()),
  BACKUP_RESTORE_ACK: z.preprocess(optional, z.string().optional()),
  BACKUP_OFFSITE_ACK: z.preprocess(optional, z.string().optional()),
}).superRefine((value, context) => {
  const origin = new URL(value.APP_URL);
  const protectedEnvironment = value.DEPLOYMENT_ENV === "staging" || value.DEPLOYMENT_ENV === "production";
  if (value.LOCAL_PRODUCTION_SIMULATION && value.DEPLOYMENT_ENV !== "staging") context.addIssue({ code: "custom", path: ["DEPLOYMENT_ENV"], message: "local production simulation must use staging" });
  if (value.INTERNAL_APP_URL && new URL(value.INTERNAL_APP_URL).protocol !== "http:") context.addIssue({ code: "custom", path: ["INTERNAL_APP_URL"], message: "must be an internal HTTP service origin" });
  if (value.PUBLIC_WEBHOOK_ORIGIN && new URL(value.PUBLIC_WEBHOOK_ORIGIN).protocol !== "https:") context.addIssue({ code: "custom", path: ["PUBLIC_WEBHOOK_ORIGIN"], message: "must use HTTPS" });
  if (protectedEnvironment && origin.protocol !== "https:") context.addIssue({ code: "custom", path: ["APP_URL"], message: "must use HTTPS in staging and production" });
  if (origin.pathname !== "/" || origin.search || origin.hash) context.addIssue({ code: "custom", path: ["APP_URL"], message: "must be a canonical origin without a path, query, or fragment" });
  if (Boolean(value.UPSTASH_REDIS_REST_URL) !== Boolean(value.UPSTASH_REDIS_REST_TOKEN)) context.addIssue({ code: "custom", path: ["UPSTASH_REDIS_REST_URL"], message: "URL and token must be configured together" });
  if (protectedEnvironment && !value.REDIS_URL && !value.UPSTASH_REDIS_REST_URL) context.addIssue({ code: "custom", path: ["REDIS_URL"], message: "a distributed Valkey/Redis backend is required" });
  if (Boolean(value.S3_ACCESS_KEY_ID) !== Boolean(value.S3_SECRET_ACCESS_KEY)) context.addIssue({ code: "custom", path: ["S3_ACCESS_KEY_ID"], message: "storage access and secret keys must be configured together" });
  if (protectedEnvironment && (!value.S3_ACCESS_KEY_ID || !value.S3_SECRET_ACCESS_KEY)) context.addIssue({ code: "custom", path: ["S3_ACCESS_KEY_ID"], message: "private object-storage credentials are required" });
  if (protectedEnvironment && value.S3_ENDPOINT && new URL(value.S3_ENDPOINT).protocol !== "https:" && !(value.LOCAL_PRODUCTION_SIMULATION && new URL(value.S3_ENDPOINT).hostname === "minio")) context.addIssue({ code: "custom", path: ["S3_ENDPOINT"], message: "must use HTTPS outside an explicitly local private-storage simulation" });
  if (protectedEnvironment && !value.S3_BUCKET.includes(value.DEPLOYMENT_ID)) context.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "must contain DEPLOYMENT_ID to prevent cross-environment sharing" });
  if (protectedEnvironment && !value.REDIS_KEY_PREFIX.includes(value.DEPLOYMENT_ID)) context.addIssue({ code: "custom", path: ["REDIS_KEY_PREFIX"], message: "must contain DEPLOYMENT_ID to prevent cross-environment sharing" });
  const environmentCredentialsRequired = value.NODE_ENV !== "test" && (value.PROVIDER_CONFIG_SOURCE === "environment" || value.PROVIDER_CONFIG_ALLOW_ENV_FALLBACK);
  if (environmentCredentialsRequired && value.PAYMENT_PROVIDER === "paymongo" && (!value.PAYMONGO_SECRET_KEY || !value.PAYMONGO_WEBHOOK_SECRET)) context.addIssue({ code: "custom", path: ["PAYMONGO_SECRET_KEY"], message: "PayMongo credentials are required for the selected provider source" });
  if (environmentCredentialsRequired && value.PAYMENT_PROVIDER === "paymongo" && !value.PAYMONGO_LIVEMODE && value.PAYMONGO_SECRET_KEY?.startsWith("sk_live_")) context.addIssue({ code: "custom", path: ["PAYMONGO_SECRET_KEY"], message: "live PayMongo credentials are forbidden when livemode is false" });
  if (environmentCredentialsRequired && value.LOCAL_PRODUCTION_SIMULATION && value.PAYMENT_PROVIDER === "paymongo" && !value.PAYMONGO_SECRET_KEY?.startsWith("sk_test_")) context.addIssue({ code: "custom", path: ["PAYMONGO_SECRET_KEY"], message: "local production simulation accepts PayMongo test credentials only" });
  if (value.LOCAL_PRODUCTION_SIMULATION && value.PAYMONGO_LIVEMODE) context.addIssue({ code: "custom", path: ["PAYMONGO_LIVEMODE"], message: "must remain false in local production simulation" });
  if (value.DEPLOYMENT_ENV === "production" && value.PAYMENT_PROVIDER === "mock") context.addIssue({ code: "custom", path: ["PAYMENT_PROVIDER"], message: "mock payments are forbidden in production" });
  if (protectedEnvironment && (!value.LICENSE_SIGNING_PRIVATE_KEY || !value.LICENSE_SIGNING_PUBLIC_KEY)) context.addIssue({ code: "custom", path: ["LICENSE_SIGNING_PRIVATE_KEY"], message: "Ed25519 lease signing keys are required in protected environments" });
  if (environmentCredentialsRequired && value.EMAIL_PROVIDER === "resend" && !value.RESEND_API_KEY) context.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "is required for the selected provider source" });
  if (value.DEPLOYMENT_ENV === "production" && value.EMAIL_PROVIDER === "log") context.addIssue({ code: "custom", path: ["EMAIL_PROVIDER"], message: "log email transport is forbidden in production" });
  if (value.PROVIDER_CONFIG_SOURCE === "database" && !value.PROVIDER_CREDENTIALS_ENCRYPTION_KEY) context.addIssue({ code: "custom", path: ["PROVIDER_CREDENTIALS_ENCRYPTION_KEY"], message: "is required for database provider configuration" });
  if (protectedEnvironment && value.SUPPORT_EMAIL.endsWith("@example.com")) context.addIssue({ code: "custom", path: ["SUPPORT_EMAIL"], message: "must be an operational address outside development" });
  if (Boolean(value.BACKUP_S3_ACCESS_KEY_ID) !== Boolean(value.BACKUP_S3_SECRET_ACCESS_KEY)) context.addIssue({ code: "custom", path: ["BACKUP_S3_ACCESS_KEY_ID"], message: "backup storage access and secret keys must be configured together" });
  if (value.BACKUP_ENABLED) {
    if (!value.BACKUP_BUCKET || !value.BACKUP_ENCRYPTION_KEY) context.addIssue({ code: "custom", path: ["BACKUP_BUCKET"], message: "backup bucket and encryption key are required when backups are enabled" });
    if (!value.BACKUP_S3_ACCESS_KEY_ID || !value.BACKUP_S3_SECRET_ACCESS_KEY) context.addIssue({ code: "custom", path: ["BACKUP_S3_ACCESS_KEY_ID"], message: "dedicated backup-storage credentials are required" });
    if (value.BACKUP_BUCKET === value.S3_BUCKET) context.addIssue({ code: "custom", path: ["BACKUP_BUCKET"], message: "must differ from the application object-storage bucket" });
    if (value.BACKUP_ENCRYPTION_KEY) {
      try {
        if (Buffer.from(value.BACKUP_ENCRYPTION_KEY, "base64").length !== 32) context.addIssue({ code: "custom", path: ["BACKUP_ENCRYPTION_KEY"], message: "must be a base64-encoded 32-byte key" });
      } catch {
        context.addIssue({ code: "custom", path: ["BACKUP_ENCRYPTION_KEY"], message: "must be valid base64" });
      }
    }
  }
  if (value.BACKUP_RESTORE_DATABASE_URL && value.BACKUP_RESTORE_DATABASE_URL === value.DATABASE_URL) context.addIssue({ code: "custom", path: ["BACKUP_RESTORE_DATABASE_URL"], message: "must be isolated from the source database" });
  if (value.BACKUP_RESTORE_S3_BUCKET && [value.S3_BUCKET, value.BACKUP_BUCKET].includes(value.BACKUP_RESTORE_S3_BUCKET)) context.addIssue({ code: "custom", path: ["BACKUP_RESTORE_S3_BUCKET"], message: "must be isolated from source and backup buckets" });
  if (protectedEnvironment && value.BACKUP_ENABLED && !value.LOCAL_PRODUCTION_SIMULATION && value.BACKUP_OFFSITE_ACK !== "SEPARATE_FAILURE_DOMAIN") context.addIssue({ code: "custom", path: ["BACKUP_OFFSITE_ACK"], message: "must acknowledge an offsite storage failure domain" });
  if (protectedEnvironment) {
    for (const key of ["SESSION_SECRET", "MFA_ENCRYPTION_KEY", "LICENSE_PEPPER", "CRON_SECRET"] as const) {
      if (key === "MFA_ENCRYPTION_KEY" && !value[key]) {
        context.addIssue({ code: "custom", path: [key], message: "is required in staging and production" });
        continue;
      }
      const configured = value[key];
      if (!configured || configured.length < 48 || placeholder.test(configured)) context.addIssue({ code: "custom", path: [key], message: "must be at least 48 characters and not a placeholder" });
    }
    if (value.PROVIDER_CREDENTIALS_ENCRYPTION_KEY && (value.PROVIDER_CREDENTIALS_ENCRYPTION_KEY.length < 48 || placeholder.test(value.PROVIDER_CREDENTIALS_ENCRYPTION_KEY))) context.addIssue({ code: "custom", path: ["PROVIDER_CREDENTIALS_ENCRYPTION_KEY"], message: "must be at least 48 characters and not a placeholder" });
    for (const key of ["PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "RESEND_API_KEY", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
      if (value[key] && placeholder.test(value[key])) context.addIssue({ code: "custom", path: [key], message: "must not be a placeholder" });
    }
  }
});

export type ServerEnvironment = z.infer<typeof environmentSchema>;

export function parseEnvironment(input: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  const parsed = environmentSchema.safeParse(input);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "environment"))];
    throw new Error(`Invalid server configuration: ${fields.join(", ")}`);
  }
  return parsed.data;
}

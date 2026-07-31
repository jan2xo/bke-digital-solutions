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
  TRUSTED_ORIGINS: z.preprocess(optional, z.string().optional()),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  DATABASE_URL: z.string().min(1),
  DIRECT_DATABASE_URL: z.preprocess(optional, z.string().min(1).optional()),
  SESSION_SECRET: secret,
  LICENSE_PEPPER: secret,
  CRON_SECRET: secret,
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
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  ALLOW_DESTRUCTIVE_ADMIN: bool.default(false),
  MONITORING_DSN: z.preprocess(optional, z.url().optional()),
  BACKUP_BUCKET: z.preprocess(optional, z.string().min(3).optional()),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
}).superRefine((value, context) => {
  const origin = new URL(value.APP_URL);
  const protectedEnvironment = value.DEPLOYMENT_ENV === "staging" || value.DEPLOYMENT_ENV === "production";
  if (protectedEnvironment && origin.protocol !== "https:") context.addIssue({ code: "custom", path: ["APP_URL"], message: "must use HTTPS in staging and production" });
  if (origin.pathname !== "/" || origin.search || origin.hash) context.addIssue({ code: "custom", path: ["APP_URL"], message: "must be a canonical origin without a path, query, or fragment" });
  if (Boolean(value.UPSTASH_REDIS_REST_URL) !== Boolean(value.UPSTASH_REDIS_REST_TOKEN)) context.addIssue({ code: "custom", path: ["UPSTASH_REDIS_REST_URL"], message: "URL and token must be configured together" });
  if (protectedEnvironment && !value.REDIS_URL && !value.UPSTASH_REDIS_REST_URL) context.addIssue({ code: "custom", path: ["REDIS_URL"], message: "a distributed Valkey/Redis backend is required" });
  if (Boolean(value.S3_ACCESS_KEY_ID) !== Boolean(value.S3_SECRET_ACCESS_KEY)) context.addIssue({ code: "custom", path: ["S3_ACCESS_KEY_ID"], message: "storage access and secret keys must be configured together" });
  if (protectedEnvironment && (!value.S3_ACCESS_KEY_ID || !value.S3_SECRET_ACCESS_KEY)) context.addIssue({ code: "custom", path: ["S3_ACCESS_KEY_ID"], message: "private object-storage credentials are required" });
  if (protectedEnvironment && value.S3_ENDPOINT && new URL(value.S3_ENDPOINT).protocol !== "https:") context.addIssue({ code: "custom", path: ["S3_ENDPOINT"], message: "must use HTTPS outside development" });
  if (protectedEnvironment && !value.S3_BUCKET.includes(value.DEPLOYMENT_ID)) context.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "must contain DEPLOYMENT_ID to prevent cross-environment sharing" });
  if (protectedEnvironment && !value.REDIS_KEY_PREFIX.includes(value.DEPLOYMENT_ID)) context.addIssue({ code: "custom", path: ["REDIS_KEY_PREFIX"], message: "must contain DEPLOYMENT_ID to prevent cross-environment sharing" });
  if (value.PAYMENT_PROVIDER === "paymongo" && (!value.PAYMONGO_SECRET_KEY || !value.PAYMONGO_WEBHOOK_SECRET)) context.addIssue({ code: "custom", path: ["PAYMONGO_SECRET_KEY"], message: "PayMongo credentials are required when selected" });
  if (value.DEPLOYMENT_ENV === "production" && value.PAYMENT_PROVIDER === "mock") context.addIssue({ code: "custom", path: ["PAYMENT_PROVIDER"], message: "mock payments are forbidden in production" });
  if (value.EMAIL_PROVIDER === "resend" && !value.RESEND_API_KEY) context.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "is required when Resend is selected" });
  if (value.DEPLOYMENT_ENV === "production" && value.EMAIL_PROVIDER === "log") context.addIssue({ code: "custom", path: ["EMAIL_PROVIDER"], message: "log email transport is forbidden in production" });
  if (protectedEnvironment && value.SUPPORT_EMAIL.endsWith("@example.com")) context.addIssue({ code: "custom", path: ["SUPPORT_EMAIL"], message: "must be an operational address outside development" });
  if (protectedEnvironment) {
    for (const key of ["SESSION_SECRET", "LICENSE_PEPPER", "CRON_SECRET"] as const) {
      if (value[key].length < 48 || placeholder.test(value[key])) context.addIssue({ code: "custom", path: [key], message: "must be at least 48 characters and not a placeholder" });
    }
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

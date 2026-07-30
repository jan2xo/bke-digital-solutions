import "server-only";
import { z } from "zod";

const blankToUndefined = (value: unknown) => value === "" ? undefined : value;
const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  LICENSE_PEPPER: z.string().min(32),
  PAYMENT_PROVIDER: z.enum(["mock", "paymongo"]).default("mock"),
  PAYMONGO_SECRET_KEY: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  PAYMONGO_WEBHOOK_SECRET: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  PAYMONGO_LIVEMODE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  RESEND_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  EMAIL_FROM: z.string().min(3),
  UPSTASH_REDIS_REST_URL: z.preprocess(blankToUndefined, z.url().optional()),
  UPSTASH_REDIS_REST_TOKEN: z.preprocess(blankToUndefined, z.string().optional()),
  S3_ENDPOINT: z.preprocess(blankToUndefined, z.url().optional()),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.preprocess(blankToUndefined, z.string().optional()),
  S3_SECRET_ACCESS_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  CRON_SECRET: z.string().min(32),
});

const parsed = serverSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid server configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
}

export const env = parsed.data;

if (env.PAYMENT_PROVIDER === "paymongo" && (!env.PAYMONGO_SECRET_KEY || !env.PAYMONGO_WEBHOOK_SECRET)) {
  throw new Error("PayMongo is selected but its server credentials are missing");
}

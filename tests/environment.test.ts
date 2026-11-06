import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEnvironment } from "@/platform/host/config/environment";

const base = {
  NODE_ENV: "production",
  DEPLOYMENT_ENV: "production",
  DEPLOYMENT_ID: "bke-production",
  APP_URL: "https://commerce.bke.example",
  DATABASE_URL: "postgresql://application:password@database:5432/bke",
  SESSION_SECRET: "s".repeat(64),
  LICENSE_PEPPER: "l".repeat(64),
  LICENSE_SIGNING_PRIVATE_KEY: "p".repeat(96),
  LICENSE_SIGNING_PUBLIC_KEY: "u".repeat(64),
  LICENSE_SIGNING_KEY_ID: "test-license-ed25519-v1",
  CRON_SECRET: "c".repeat(64),
  REDIS_URL: "redis://valkey:6379",
  REDIS_KEY_PREFIX: "bke-production",
  PAYMENT_PROVIDER: "paymongo",
  PAYMONGO_SECRET_KEY: "sk_test_" + "p".repeat(32),
  PAYMONGO_WEBHOOK_SECRET: "webhook-key-" + "w".repeat(32),
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "email-key-" + "e".repeat(32),
  EMAIL_FROM: "BKE Digital Solutions <no-reply@bke.example>",
  SUPPORT_EMAIL: "support@bke.example",
};

const productionRuntimeEnvironment = () => {
  const compose = readFileSync("docker-compose.production.yml", "utf8");
  const match = compose.match(/^x-runtime-environment: &runtime-environment\n((?:  - .+\n)+)/m);
  expect(match).not.toBeNull();
  return match![1].trim().split("\n").map((line) => line.replace(/^\s*- /, ""));
};

const validatedProductionRuntimeNames = [
  "SESSION_SECRET",
  "LICENSE_PEPPER",
  "BKE_AGENT_UPDATE_SIGNING_KEYS",
  "CRON_SECRET",
  "PROVIDER_CREDENTIALS_ENCRYPTION_KEY",
  "PAYMONGO_SECRET_KEY",
  "PAYMONGO_WEBHOOK_SECRET",
  "RESEND_API_KEY",
];

describe("deployment environment validation", () => {
  it("wires validated production runtime variable names through Compose without secret values", () => {
    const names = productionRuntimeEnvironment();
    expect(names).toEqual(expect.arrayContaining(validatedProductionRuntimeNames));
    expect(names.every((name) => /^[A-Z0-9_]+$/.test(name))).toBe(true);
  });
  it("does not require retired BKE MFA or owner-MFA-recovery keys", () => {
    expect(parseEnvironment(base)).toMatchObject({ DEPLOYMENT_ENV: "production" });
  });
  it("accepts an isolated production configuration", () => expect(parseEnvironment(base)).toMatchObject({ DEPLOYMENT_ENV: "production", PAYMENT_PROVIDER: "paymongo", EMAIL_PROVIDER: "resend" }));
  it("does not require a browser upload endpoint for retired artifact uploads", () => expect(parseEnvironment({ ...base, S3_PUBLIC_UPLOAD_ENDPOINT: undefined })).toMatchObject({ DEPLOYMENT_ENV: "production" }));
  it("rejects insecure production origins and mock providers", () => expect(() => parseEnvironment({ ...base, APP_URL: "http://commerce.bke.example", PAYMENT_PROVIDER: "mock" })).toThrow(/APP_URL|PAYMENT_PROVIDER/));
  it("rejects paths on the canonical origin", () => expect(() => parseEnvironment({ ...base, APP_URL: "https://commerce.bke.example/app" })).toThrow("APP_URL"));
  it("rejects placeholder secrets", () => expect(() => parseEnvironment({ ...base, SESSION_SECRET: "replace-with-a-production-session-secret-value-123456" })).toThrow("SESSION_SECRET"));
  it("keeps Agent account sessions disabled without dedicated secrets", () => expect(parseEnvironment(base)).toMatchObject({ AGENT_ACCOUNT_SESSION_ENABLED: false }));
  it("requires dedicated Agent account-session secrets only when explicitly enabled", () => {
    expect(() => parseEnvironment({ ...base, AGENT_ACCOUNT_SESSION_ENABLED: "true" })).toThrow(/AGENT_ACCOUNT_SESSION_PEPPER|AGENT_ACCOUNT_SESSION_ENCRYPTION_KEY/);
    expect(parseEnvironment({
      ...base,
      AGENT_ACCOUNT_SESSION_ENABLED: "true",
      AGENT_ACCOUNT_SESSION_PEPPER: "p".repeat(64),
      AGENT_ACCOUNT_SESSION_ENCRYPTION_KEY: "e".repeat(64),
    })).toMatchObject({ AGENT_ACCOUNT_SESSION_ENABLED: true });
  });
  it("accepts database provider configuration without environment provider credentials", () => expect(parseEnvironment({ ...base, PROVIDER_CONFIG_SOURCE: "database", PROVIDER_CREDENTIALS_ENCRYPTION_KEY: "k".repeat(64), PAYMONGO_SECRET_KEY: undefined, PAYMONGO_WEBHOOK_SECRET: undefined, RESEND_API_KEY: undefined })).toMatchObject({ PROVIDER_CONFIG_SOURCE: "database" }));
  it("requires a strong master key for database provider configuration", () => expect(() => parseEnvironment({ ...base, PROVIDER_CONFIG_SOURCE: "database", PROVIDER_CREDENTIALS_ENCRYPTION_KEY: undefined, PAYMONGO_SECRET_KEY: undefined, PAYMONGO_WEBHOOK_SECRET: undefined, RESEND_API_KEY: undefined })).toThrow("PROVIDER_CREDENTIALS_ENCRYPTION_KEY"));
  it("requires environment credentials when database fallback is explicitly enabled", () => expect(() => parseEnvironment({ ...base, PROVIDER_CONFIG_SOURCE: "database", PROVIDER_CONFIG_ALLOW_ENV_FALLBACK: "true", PROVIDER_CREDENTIALS_ENCRYPTION_KEY: "k".repeat(64), PAYMONGO_SECRET_KEY: undefined, PAYMONGO_WEBHOOK_SECRET: undefined, RESEND_API_KEY: undefined })).toThrow(/PAYMONGO_SECRET_KEY|RESEND_API_KEY/));
  it("accepts separately keyed offsite backup configuration", () => expect(parseEnvironment({ ...base, BACKUP_ENABLED: "true", BACKUP_S3_ENDPOINT: "https://offsite.example", BACKUP_BUCKET: "bke-production-backups", BACKUP_S3_ACCESS_KEY_ID: "backup-access", BACKUP_S3_SECRET_ACCESS_KEY: "backup-secret", BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), BACKUP_OFFSITE_ACK: "SEPARATE_FAILURE_DOMAIN" })).toMatchObject({ BACKUP_ENABLED: true, BACKUP_BUCKET: "bke-production-backups" }));
  it("rejects HTTP offsite backup storage in production", () => expect(() => parseEnvironment({ ...base, BACKUP_ENABLED: "true", BACKUP_S3_ENDPOINT: "http://offsite.example", BACKUP_BUCKET: "bke-production-backups", BACKUP_S3_ACCESS_KEY_ID: "backup-access", BACKUP_S3_SECRET_ACCESS_KEY: "backup-secret", BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), BACKUP_OFFSITE_ACK: "SEPARATE_FAILURE_DOMAIN" })).toThrow("BACKUP_S3_ENDPOINT"));
  it("rejects invalid database-backup encryption keys", () => expect(() => parseEnvironment({ ...base, BACKUP_ENABLED: "true", BACKUP_BUCKET: "bke-production-backups", BACKUP_S3_ACCESS_KEY_ID: "backup-access", BACKUP_S3_SECRET_ACCESS_KEY: "backup-secret", BACKUP_ENCRYPTION_KEY: "not-a-32-byte-base64-key", BACKUP_OFFSITE_ACK: "SEPARATE_FAILURE_DOMAIN" })).toThrow("BACKUP_ENCRYPTION_KEY"));
  it("rejects restore targets that reuse the production database", () => expect(() => parseEnvironment({ ...base, BACKUP_RESTORE_DATABASE_URL: base.DATABASE_URL })).toThrow("BACKUP_RESTORE_DATABASE_URL"));
  it("accepts a staging-only local production simulation", () => expect(parseEnvironment({ ...base, DEPLOYMENT_ENV: "staging", DEPLOYMENT_ID: "bke-local-certification", LOCAL_PRODUCTION_SIMULATION: "true", APP_URL: "https://jl-bke.localhost:8443", INTERNAL_APP_URL: "http://app:3000", PUBLIC_WEBHOOK_ORIGIN: "https://temporary.example.net", REDIS_KEY_PREFIX: "bke-local-certification" })).toMatchObject({ LOCAL_PRODUCTION_SIMULATION: true }));
  it("rejects live credentials and insecure tunnel origins in local simulation", () => expect(() => parseEnvironment({ ...base, DEPLOYMENT_ENV: "staging", DEPLOYMENT_ID: "bke-local-certification", LOCAL_PRODUCTION_SIMULATION: "true", APP_URL: "https://jl-bke.localhost:8443", PUBLIC_WEBHOOK_ORIGIN: "http://temporary.example.net", REDIS_KEY_PREFIX: "bke-local-certification", PAYMONGO_SECRET_KEY: "sk_live_" + "p".repeat(32) })).toThrow(/PUBLIC_WEBHOOK_ORIGIN|PAYMONGO_SECRET_KEY/));
  it("permits mock providers and HTTP only in development", () => expect(parseEnvironment({ ...base, NODE_ENV: "development", DEPLOYMENT_ENV: "development", DEPLOYMENT_ID: "bke-development", APP_URL: "http://localhost:3000", SESSION_SECRET: "x".repeat(32), LICENSE_PEPPER: "y".repeat(32), CRON_SECRET: "z".repeat(32), REDIS_URL: undefined, REDIS_KEY_PREFIX: "bke-development", PAYMENT_PROVIDER: "mock", PAYMONGO_SECRET_KEY: undefined, PAYMONGO_WEBHOOK_SECRET: undefined, EMAIL_PROVIDER: "log", RESEND_API_KEY: undefined, EMAIL_FROM: "test@example.com", SUPPORT_EMAIL: "support@example.com" })).toMatchObject({ DEPLOYMENT_ENV: "development" }));
});


describe("GitHub-only protected storage configuration", () => {
  it("accepts protected startup without S3 configuration", () => {
    const withoutS3 = Object.fromEntries(Object.entries(base).filter(([key]) => !key.startsWith("S3_")));
    expect(parseEnvironment(withoutS3).DEPLOYMENT_ENV).toBe("production");
  });

  it("ignores stale product-storage S3 variables after product storage retirement", () => {
    const withoutS3 = Object.fromEntries(Object.entries(base).filter(([key]) => !key.startsWith("S3_")));
    const parsed = parseEnvironment({
      ...withoutS3,
      S3_BUCKET: "bke-production-private",
      S3_ENDPOINT: "https://retired-product-storage.example",
      S3_PUBLIC_UPLOAD_ENDPOINT: "https://retired-upload.example",
      S3_ACCESS_KEY_ID: "retired-product-storage-key",
      S3_SECRET_ACCESS_KEY: "retired-product-storage-secret",
    });
    expect(parsed.DEPLOYMENT_ENV).toBe("production");
    expect(parsed).not.toHaveProperty("S3_BUCKET");
    expect(parsed).not.toHaveProperty("S3_ACCESS_KEY_ID");
  });
});

import { describe, expect, it } from "vitest";
import { parseEnvironment } from "@/lib/config/environment";

const base = {
  NODE_ENV: "production",
  DEPLOYMENT_ENV: "production",
  DEPLOYMENT_ID: "bke-production",
  APP_URL: "https://commerce.bke.example",
  DATABASE_URL: "postgresql://application:password@database:5432/bke",
  SESSION_SECRET: "s".repeat(64),
  MFA_ENCRYPTION_KEY: "m".repeat(64),
  LICENSE_PEPPER: "l".repeat(64),
  LICENSE_SIGNING_PRIVATE_KEY: "p".repeat(96),
  LICENSE_SIGNING_PUBLIC_KEY: "u".repeat(64),
  LICENSE_SIGNING_KEY_ID: "test-license-ed25519-v1",
  SUPPLY_CHAIN_SIGNING_PRIVATE_KEY: "supply-chain-private-test-material-" + "s".repeat(64),
  CRON_SECRET: "c".repeat(64),
  REDIS_URL: "redis://valkey:6379",
  REDIS_KEY_PREFIX: "bke-production",
  S3_BUCKET: "bke-production-private",
  S3_ACCESS_KEY_ID: "storage-access-value",
  S3_SECRET_ACCESS_KEY: "storage-secret-value",
  PAYMENT_PROVIDER: "paymongo",
  PAYMONGO_SECRET_KEY: "sk_test_" + "p".repeat(32),
  PAYMONGO_WEBHOOK_SECRET: "webhook-key-" + "w".repeat(32),
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "email-key-" + "e".repeat(32),
  EMAIL_FROM: "BKE Digital Solutions <no-reply@bke.example>",
  SUPPORT_EMAIL: "support@bke.example",
};

describe("deployment environment validation", () => {
  it("accepts an isolated production configuration", () => expect(parseEnvironment(base)).toMatchObject({ DEPLOYMENT_ENV: "production", PAYMENT_PROVIDER: "paymongo", EMAIL_PROVIDER: "resend" }));
  it("rejects insecure production origins and mock providers", () => expect(() => parseEnvironment({ ...base, APP_URL: "http://commerce.bke.example", PAYMENT_PROVIDER: "mock" })).toThrow(/APP_URL|PAYMENT_PROVIDER/));
  it("rejects paths on the canonical origin", () => expect(() => parseEnvironment({ ...base, APP_URL: "https://commerce.bke.example/app" })).toThrow("APP_URL"));
  it("rejects shared storage and Valkey namespaces", () => expect(() => parseEnvironment({ ...base, S3_BUCKET: "shared-private", REDIS_KEY_PREFIX: "shared" })).toThrow(/S3_BUCKET|REDIS_KEY_PREFIX/));
  it("rejects placeholder secrets", () => expect(() => parseEnvironment({ ...base, SESSION_SECRET: "replace-with-a-production-session-secret-value-123456" })).toThrow("SESSION_SECRET"));
  it("accepts database provider configuration without environment provider credentials", () => expect(parseEnvironment({ ...base, PROVIDER_CONFIG_SOURCE: "database", PROVIDER_CREDENTIALS_ENCRYPTION_KEY: "k".repeat(64), PAYMONGO_SECRET_KEY: undefined, PAYMONGO_WEBHOOK_SECRET: undefined, RESEND_API_KEY: undefined })).toMatchObject({ PROVIDER_CONFIG_SOURCE: "database" }));
  it("requires a strong master key for database provider configuration", () => expect(() => parseEnvironment({ ...base, PROVIDER_CONFIG_SOURCE: "database", PROVIDER_CREDENTIALS_ENCRYPTION_KEY: undefined, PAYMONGO_SECRET_KEY: undefined, PAYMONGO_WEBHOOK_SECRET: undefined, RESEND_API_KEY: undefined })).toThrow("PROVIDER_CREDENTIALS_ENCRYPTION_KEY"));
  it("requires environment credentials when database fallback is explicitly enabled", () => expect(() => parseEnvironment({ ...base, PROVIDER_CONFIG_SOURCE: "database", PROVIDER_CONFIG_ALLOW_ENV_FALLBACK: "true", PROVIDER_CREDENTIALS_ENCRYPTION_KEY: "k".repeat(64), PAYMONGO_SECRET_KEY: undefined, PAYMONGO_WEBHOOK_SECRET: undefined, RESEND_API_KEY: undefined })).toThrow(/PAYMONGO_SECRET_KEY|RESEND_API_KEY/));
  it("accepts separately keyed offsite backup configuration", () => expect(parseEnvironment({ ...base, BACKUP_ENABLED: "true", BACKUP_S3_ENDPOINT: "https://offsite.example", BACKUP_BUCKET: "bke-production-backups", BACKUP_S3_ACCESS_KEY_ID: "backup-access", BACKUP_S3_SECRET_ACCESS_KEY: "backup-secret", BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), BACKUP_OFFSITE_ACK: "SEPARATE_FAILURE_DOMAIN" })).toMatchObject({ BACKUP_ENABLED: true, BACKUP_BUCKET: "bke-production-backups" }));
  it("rejects HTTP offsite backup storage in production", () => expect(() => parseEnvironment({ ...base, BACKUP_ENABLED: "true", BACKUP_S3_ENDPOINT: "http://offsite.example", BACKUP_BUCKET: "bke-production-backups", BACKUP_S3_ACCESS_KEY_ID: "backup-access", BACKUP_S3_SECRET_ACCESS_KEY: "backup-secret", BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), BACKUP_OFFSITE_ACK: "SEPARATE_FAILURE_DOMAIN" })).toThrow("BACKUP_S3_ENDPOINT"));
  it("rejects source-bucket reuse and invalid backup encryption keys", () => expect(() => parseEnvironment({ ...base, BACKUP_ENABLED: "true", BACKUP_BUCKET: base.S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID: "backup-access", BACKUP_S3_SECRET_ACCESS_KEY: "backup-secret", BACKUP_ENCRYPTION_KEY: "not-a-32-byte-base64-key", BACKUP_OFFSITE_ACK: "SEPARATE_FAILURE_DOMAIN" })).toThrow(/BACKUP_BUCKET|BACKUP_ENCRYPTION_KEY/));
  it("rejects restore targets that reuse source destinations", () => expect(() => parseEnvironment({ ...base, BACKUP_RESTORE_DATABASE_URL: base.DATABASE_URL, BACKUP_RESTORE_S3_BUCKET: base.S3_BUCKET })).toThrow(/BACKUP_RESTORE_DATABASE_URL|BACKUP_RESTORE_S3_BUCKET/));
  it("accepts a staging-only local production simulation", () => expect(parseEnvironment({ ...base, DEPLOYMENT_ENV: "staging", DEPLOYMENT_ID: "bke-local-certification", LOCAL_PRODUCTION_SIMULATION: "true", APP_URL: "https://jl-bke.localhost:8443", INTERNAL_APP_URL: "http://app:3000", PUBLIC_WEBHOOK_ORIGIN: "https://temporary.example.net", REDIS_KEY_PREFIX: "bke-local-certification", S3_ENDPOINT: "http://minio:9000", S3_BUCKET: "bke-local-certification-private" })).toMatchObject({ LOCAL_PRODUCTION_SIMULATION: true }));
  it("accepts only the exact private production MinIO origin", () => expect(parseEnvironment({ ...base, S3_ENDPOINT: "http://minio:9000" })).toMatchObject({ S3_ENDPOINT: "http://minio:9000" }));
  it.each(["http://minio:9001", "http://minio:9000/path", "http://other-host:9000", "http://localhost:9000"])("rejects unsupported private storage endpoint %s", (S3_ENDPOINT) => expect(() => parseEnvironment({ ...base, S3_ENDPOINT })).toThrow("S3_ENDPOINT"));
  it("rejects live credentials and insecure tunnel origins in local simulation", () => expect(() => parseEnvironment({ ...base, DEPLOYMENT_ENV: "staging", DEPLOYMENT_ID: "bke-local-certification", LOCAL_PRODUCTION_SIMULATION: "true", APP_URL: "https://jl-bke.localhost:8443", PUBLIC_WEBHOOK_ORIGIN: "http://temporary.example.net", REDIS_KEY_PREFIX: "bke-local-certification", S3_BUCKET: "bke-local-certification-private", PAYMONGO_SECRET_KEY: "sk_live_" + "p".repeat(32) })).toThrow(/PUBLIC_WEBHOOK_ORIGIN|PAYMONGO_SECRET_KEY/));
  it("permits mock providers and HTTP only in development", () => expect(parseEnvironment({ ...base, NODE_ENV: "development", DEPLOYMENT_ENV: "development", DEPLOYMENT_ID: "bke-development", APP_URL: "http://localhost:3000", SESSION_SECRET: "x".repeat(32), LICENSE_PEPPER: "y".repeat(32), CRON_SECRET: "z".repeat(32), REDIS_URL: undefined, REDIS_KEY_PREFIX: "bke-development", S3_BUCKET: "bke-private", S3_ACCESS_KEY_ID: undefined, S3_SECRET_ACCESS_KEY: undefined, PAYMENT_PROVIDER: "mock", PAYMONGO_SECRET_KEY: undefined, PAYMONGO_WEBHOOK_SECRET: undefined, EMAIL_PROVIDER: "log", RESEND_API_KEY: undefined, EMAIL_FROM: "test@example.com", SUPPORT_EMAIL: "support@example.com" })).toMatchObject({ DEPLOYMENT_ENV: "development" }));
});

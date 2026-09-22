import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseSimpleEnv,
  renderDisposableEnvironment,
} from "../scripts/v3-disposable-env.mjs";

const secret = "x".repeat(64);
const secrets = {
  SESSION_SECRET: secret,
  MFA_ENCRYPTION_KEY: secret,
  LICENSE_PEPPER: secret,
  CLAIM_CODE_ENCRYPTION_KEY: secret,
  AGENT_ACCOUNT_SESSION_PEPPER: secret,
  AGENT_ACCOUNT_SESSION_ENCRYPTION_KEY: secret,
  ADMIN_OWNER_RECOVERY_KEY: secret,
  PROVIDER_CREDENTIALS_ENCRYPTION_KEY: secret,
  CRON_SECRET: secret,
  RELEASE_EVIDENCE_INGESTION_TOKEN: secret,
  POSTGRES_PASSWORD: "db-password",
  MINIO_ROOT_PASSWORD: "minio-password",
  S3_SECRET_ACCESS_KEY: "storage-secret",
  BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

describe("V3 disposable certification environment", () => {
  it("does not require host-installed tsx for doctor validation", () => {
    const doctor = readFileSync("scripts/v3-disposable-doctor.mjs", "utf8");
    expect(doctor).not.toContain('runCheck("environment schema", "npm"');
    expect(doctor).toContain('"operations"');
    expect(doctor).toContain('"config:validate"');
  });

  it("parses values containing equals signs", () => {
    expect(parseSimpleEnv("A=one=two\nB=three\n")).toEqual({
      A: "one=two",
      B: "three",
    });
  });

  it("renders container-native authority and dependency addresses", () => {
    const output = renderDisposableEnvironment({
      secrets,
      licensePrivateBase64: "license-private",
      licensePublicBase64: "license-public",
      supplyPrivateBase64: "supply-private",
      supplyPublicBase64: "supply-public",
    });

    expect(output).toContain("APP_URL=https://bke-v3.test:8443");
    expect(output).toContain("@postgres:5432/bke_v3");
    expect(output).toContain("REDIS_URL=redis://valkey:6379");
    expect(output).toContain("S3_ENDPOINT=http://minio:9000");
    expect(output).not.toContain("localhost:5432");
    expect(output).not.toContain("localhost:6379");
    expect(output).not.toContain("localhost:9000");
  });

  it("locks external providers to disposable transports", () => {
    const output = renderDisposableEnvironment({
      secrets,
      licensePrivateBase64: "license-private",
      licensePublicBase64: "license-public",
      supplyPrivateBase64: "supply-private",
      supplyPublicBase64: "supply-public",
    });

    expect(output).toContain("NODE_ENV=production");
    expect(output).toContain("DEPLOYMENT_ENV=test");
    expect(output).toContain("PAYMENT_PROVIDER=mock");
    expect(output).toContain("PAYMONGO_SECRET_KEY=\n");
    expect(output).toContain("PAYMONGO_LIVEMODE=false");
    expect(output).toContain("EMAIL_PROVIDER=log");
    expect(output).toContain("RESEND_API_KEY=\n");
    expect(output).toContain("V3_AGENT_ACCOUNT_SESSION_ENABLED=true");
  });
});

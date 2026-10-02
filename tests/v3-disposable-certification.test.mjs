import { generateKeyPairSync } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseSimpleEnv,
  readAgentUpdateSigningBundle,
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

  it("verifies the disposable Agent update signing pair and rejects drift", () => {
    const root = mkdtempSync(join(tmpdir(), "bke-agent-update-signing-"));
    try {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const privatePem = privateKey.export({
        format: "pem",
        type: "pkcs8",
      }).toString();
      const publicJwk = publicKey.export({ format: "jwk" });
      if (typeof publicJwk.x !== "string") {
        throw new Error("test Ed25519 public key missing x");
      }

      const privatePath = join(root, "agent-update-signing-private.pem");
      const publicPath = join(root, "agent-update-signing-public.json");
      const keyId = "bke-agent-update-preproduction-test-v1";
      writeFileSync(privatePath, privatePem, "utf8");
      writeFileSync(
        publicPath,
        JSON.stringify({
          schema: "bke.update-authority-key.v1",
          key_id: keyId,
          algorithm: "Ed25519",
          public_key: Buffer.from(publicJwk.x, "base64url").toString("base64"),
        }),
        "utf8",
      );

      const verified = readAgentUpdateSigningBundle(
        privatePath,
        publicPath,
      );
      expect(verified.keyId).toBe(keyId);
      const map = JSON.parse(verified.signingKeysJson);
      expect(Object.keys(map)).toEqual([keyId]);
      expect(
        Buffer.from(map[keyId], "base64").toString("utf8"),
      ).toBe(privatePem);

      writeFileSync(
        publicPath,
        JSON.stringify({
          schema: "bke.update-authority-key.v1",
          key_id: keyId,
          algorithm: "Ed25519",
          public_key: Buffer.alloc(32, 9).toString("base64"),
        }),
        "utf8",
      );
      expect(() =>
        readAgentUpdateSigningBundle(privatePath, publicPath),
      ).toThrow("AGENT_UPDATE_SIGNING_KEYPAIR_MISMATCH");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
      agentUpdateSigningKeysJson: '{"bke-agent-update-preproduction-v1":"private-key-base64"}',
    });

    expect(output).toContain("APP_URL=https://bke-v3.test:8443");
    expect(output).toContain(
      "BKE_PUBLIC_DOWNLOAD_URL=https://github.com/jan2xo/bke-launcher/releases/download/bke-v0.1.0-preproduction.20261002.1/BKE-0.1.0-PREPRODUCTION-Windows.exe",
    );
    expect(output).toContain("@postgres:5432/bke_v3");
    expect(output).toContain("REDIS_URL=redis://valkey:6379");
    expect(output).toContain("S3_ENDPOINT=http://minio:9000");
    expect(output).toContain(
      'BKE_AGENT_UPDATE_SIGNING_KEYS={"bke-agent-update-preproduction-v1":"private-key-base64"}',
    );
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
      agentUpdateSigningKeysJson: '{"bke-agent-update-preproduction-v1":"private-key-base64"}',
    });

    expect(output).toContain("NODE_ENV=production");
    expect(output).toContain("DEPLOYMENT_ENV=test");
    expect(output).toContain("PAYMENT_PROVIDER=mock");
    expect(output).toContain("PAYMONGO_SECRET_KEY=\n");
    expect(output).toContain("PAYMONGO_LIVEMODE=false");
    expect(output).toContain("EMAIL_PROVIDER=log");
    expect(output).toContain("RESEND_API_KEY=\n");
    expect(output).toContain("CLAIM_CODE_CHECKOUT_ENABLED=false");
    expect(output).toContain("AGENT_ACCOUNT_SESSION_ENABLED=true");
    expect(output).not.toContain("V3_CLAIM_CODE_CHECKOUT_ENABLED");
    expect(output).not.toContain("V3_AGENT_ACCOUNT_SESSION_ENABLED");
    expect(output).not.toContain("V3_AGENT_UPDATE_SIGNING_KEYS");
  });
});

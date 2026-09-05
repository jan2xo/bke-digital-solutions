import "server-only";

import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { Redis as UpstashRedis } from "@upstash/redis";
import { Pool } from "pg";
import { createClient } from "redis";
import {
  createCoreReadinessChecker,
  type ReadinessEventSink,
} from "@/v2/platform/health";
import {
  createProviderConfigurationPlatform,
  type ProviderConfigurationStore,
  type ProviderContext,
  type ProviderCredentialKeyRing,
  type ProviderName,
  type ProviderRuntimeEnvironment,
  type StoredProviderConfiguration,
} from "@/v2/platform/providers";

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`Missing web host health environment: ${name}`);
  return value;
}

function boolean(name: string, fallback = false): boolean {
  const value = optional(name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid web host health environment: ${name}`);
}

function positiveInteger(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid web host health environment: ${name}`);
  }
  return value;
}

function providerRuntimeEnvironment(): ProviderRuntimeEnvironment {
  const source = optional("PROVIDER_CONFIG_SOURCE") ?? "environment";
  if (source !== "environment" && source !== "database") {
    throw new Error("Invalid web host health environment: PROVIDER_CONFIG_SOURCE");
  }
  return Object.freeze({
    source,
    allowEnvironmentFallback: boolean("PROVIDER_CONFIG_ALLOW_ENV_FALLBACK"),
    deploymentEnvironment: optional("DEPLOYMENT_ENV") ?? "development",
    localProductionSimulation: boolean("LOCAL_PRODUCTION_SIMULATION"),
    payMongoLivemode: boolean("PAYMONGO_LIVEMODE"),
    payMongoSecretKey: optional("PAYMONGO_SECRET_KEY"),
    payMongoWebhookSecret: optional("PAYMONGO_WEBHOOK_SECRET"),
    resendApiKey: optional("RESEND_API_KEY"),
    emailFrom: optional("EMAIL_FROM") ?? "BKE Digital Solutions <support@example.com>",
    supportEmail: optional("SUPPORT_EMAIL") ?? "support@example.com",
  });
}

function providerKeyRing(): ProviderCredentialKeyRing {
  let previousKeys: Record<number, string> = {};
  const rawPrevious = optional("PROVIDER_CREDENTIALS_PREVIOUS_KEYS");
  if (rawPrevious) {
    try {
      const parsed = JSON.parse(rawPrevious) as Record<string, unknown>;
      previousKeys = Object.fromEntries(
        Object.entries(parsed)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .map(([version, key]) => [Number(version), key])
          .filter(([version]) => Number.isInteger(version) && version > 0),
      );
    } catch {
      previousKeys = {};
    }
  }
  return Object.freeze({
    currentVersion: positiveInteger("PROVIDER_CREDENTIALS_KEY_VERSION", 1),
    currentKey: optional("PROVIDER_CREDENTIALS_ENCRYPTION_KEY"),
    previousKeys: Object.freeze(previousKeys),
  });
}

type ProviderConfigurationRow = Readonly<{
  id: string;
  provider: ProviderName;
  environment: ProviderContext;
  enabled: boolean;
  validationStatus: StoredProviderConfiguration["validationStatus"];
  senderName: string | null;
  senderEmail: string | null;
  supportEmail: string | null;
}>;

type ProviderCredentialRow = Readonly<{
  credentialType: StoredProviderConfiguration["credentials"][number]["credentialType"];
  encryptedValue: string;
  encryptionKeyVersion: number;
  maskedHint: string | null;
}>;

function readOnlyProviderStore(pool: Pool): ProviderConfigurationStore {
  return {
    async get(provider, environment) {
      const configuration = await pool.query<ProviderConfigurationRow>(
        `SELECT id, provider::text AS provider, environment::text AS environment,
                enabled, "validationStatus"::text AS "validationStatus",
                "senderName", "senderEmail", "supportEmail"
           FROM "ExternalProviderConfiguration"
          WHERE provider = $1::"ExternalProvider"
            AND environment = $2::"ProviderEnvironment"
          LIMIT 1`,
        [provider, environment],
      );
      const row = configuration.rows[0];
      if (!row) return null;
      const credentials = await pool.query<ProviderCredentialRow>(
        `SELECT "credentialType"::text AS "credentialType", "encryptedValue",
                "encryptionKeyVersion", "maskedHint"
           FROM "ExternalProviderCredential"
          WHERE "configurationId" = $1 AND "revokedAt" IS NULL`,
        [row.id],
      );
      return Object.freeze({
        ...row,
        credentials: Object.freeze(
          credentials.rows.map((credential) =>
            Object.freeze({
              credentialType: credential.credentialType,
              encryptedValue: credential.encryptedValue,
              encryptionKeyVersion: credential.encryptionKeyVersion,
              ...(credential.maskedHint ? { maskedHint: credential.maskedHint } : {}),
            }),
          ),
        ),
      });
    },
    async saveConfiguration() {
      throw new Error("PROVIDER_STORE_WRITE_UNAVAILABLE");
    },
    async setEnabled() {
      throw new Error("PROVIDER_STORE_WRITE_UNAVAILABLE");
    },
    async revokeCredentials() {
      throw new Error("PROVIDER_STORE_WRITE_UNAVAILABLE");
    },
    async recordValidation() {
      throw new Error("PROVIDER_STORE_WRITE_UNAVAILABLE");
    },
  };
}

async function checkPostgreSql(): Promise<void> {
  const pool = new Pool({ connectionString: required("DATABASE_URL"), max: 1 });
  try {
    await pool.query("SELECT 1");
  } finally {
    await pool.end();
  }
}

async function checkValkey(): Promise<void> {
  const upstashUrl = optional("UPSTASH_REDIS_REST_URL");
  const upstashToken = optional("UPSTASH_REDIS_REST_TOKEN");
  if (Boolean(upstashUrl) !== Boolean(upstashToken)) {
    throw new Error("VALKEY_NOT_CONFIGURED");
  }
  if (upstashUrl && upstashToken) {
    await new UpstashRedis({ url: upstashUrl, token: upstashToken }).ping();
    return;
  }
  const redisUrl = optional("REDIS_URL");
  if (!redisUrl) throw new Error("VALKEY_NOT_CONFIGURED");
  const client = createClient({ url: redisUrl, socket: { connectTimeout: 2_500 } });
  try {
    await client.connect();
    await client.ping();
  } finally {
    if (client.isOpen) await client.quit();
  }
}

async function checkObjectStorage(): Promise<void> {
  const accessKeyId = required("S3_ACCESS_KEY_ID");
  const secretAccessKey = required("S3_SECRET_ACCESS_KEY");
  const client = new S3Client({
    region: optional("S3_REGION") ?? "auto",
    endpoint: optional("S3_ENDPOINT"),
    forcePathStyle: boolean("S3_FORCE_PATH_STYLE", true),
    credentials: { accessKeyId, secretAccessKey },
  });
  await client.send(new HeadBucketCommand({ Bucket: required("S3_BUCKET") }));
}

async function checkConfiguredProviders(): Promise<void> {
  const paymentProvider = optional("PAYMENT_PROVIDER") ?? "mock";
  const emailProvider = optional("EMAIL_PROVIDER") ?? "log";
  if (paymentProvider !== "mock" && paymentProvider !== "paymongo") {
    throw new Error("PROVIDER_SELECTION_INVALID");
  }
  if (emailProvider !== "log" && emailProvider !== "resend") {
    throw new Error("PROVIDER_SELECTION_INVALID");
  }
  if (paymentProvider === "mock" && emailProvider === "log") return;

  const pool = new Pool({ connectionString: required("DATABASE_URL"), max: 1 });
  try {
    const platform = createProviderConfigurationPlatform({
      store: readOnlyProviderStore(pool),
      runtime: providerRuntimeEnvironment(),
      keyRing: providerKeyRing(),
      validation: {
        async validatePayMongo() {
          throw new Error("PROVIDER_VALIDATION_UNAVAILABLE");
        },
        async validateResend() {
          throw new Error("PROVIDER_VALIDATION_UNAVAILABLE");
        },
      },
    });
    if (paymentProvider === "paymongo") await platform.resolvePayMongo();
    if (emailProvider === "resend") await platform.resolveResend();
  } finally {
    await pool.end();
  }
}

const events: ReadinessEventSink = {
  emit(event) {
    console.warn(JSON.stringify(event));
  },
};

export const readiness = createCoreReadinessChecker({
  dependencies: {
    postgresql: checkPostgreSql,
    valkey: checkValkey,
    objectStorage: checkObjectStorage,
    providers: checkConfiguredProviders,
  },
  events,
  timeoutMs: 3_000,
});

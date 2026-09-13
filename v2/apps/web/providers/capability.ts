import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  createProviderConfigurationPlatform,
  type ProviderConfigurationStore,
  type ProviderContext,
  type ProviderCredentialKeyRing,
  type ProviderCredentialKind,
  type ProviderName,
  type ProviderOperationalEvent,
  type ProviderRuntimeEnvironment,
  type StoredProviderConfiguration,
} from "@/v2/platform/providers";
import { audit } from "@/v2/apps/web/audit";
import { getPostgresPool } from "@/v2/apps/web/persistence/postgres";
import { securityEventDefinition } from "@/v2/apps/web/security/events";

function bool(name: string, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (value == null || value === "") return fallback;
  return value === "true" || value === "1";
}

function integer(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function runtime(): ProviderRuntimeEnvironment {
  return {
    source: process.env.PROVIDER_CONFIG_SOURCE === "environment" ? "environment" : "database",
    allowEnvironmentFallback: bool("PROVIDER_CONFIG_ALLOW_ENV_FALLBACK"),
    deploymentEnvironment: process.env.DEPLOYMENT_ENV?.trim() || process.env.NODE_ENV?.trim() || "development",
    localProductionSimulation: bool("LOCAL_PRODUCTION_SIMULATION"),
    payMongoLivemode: bool("PAYMONGO_LIVEMODE"),
    payMongoSecretKey: process.env.PAYMONGO_SECRET_KEY,
    payMongoWebhookSecret: process.env.PAYMONGO_WEBHOOK_SECRET,
    resendApiKey: process.env.RESEND_API_KEY,
    emailFrom: process.env.EMAIL_FROM?.trim() || "BKE Digital Solutions <noreply@jl-bke.com>",
    supportEmail: process.env.SUPPORT_EMAIL?.trim() || "support@jl-bke.com",
  };
}

function keyRing(): ProviderCredentialKeyRing {
  const previous: Record<number, string> = {};
  for (const item of (process.env.PROVIDER_CREDENTIALS_PREVIOUS_KEYS ?? "").split(",")) {
    const separator = item.indexOf(":");
    if (separator < 1) continue;
    const version = Number(item.slice(0, separator).trim());
    const material = item.slice(separator + 1).trim();
    if (Number.isInteger(version) && version > 0 && material) previous[version] = material;
  }
  return {
    currentVersion: integer("PROVIDER_CREDENTIALS_KEY_VERSION", 1),
    currentKey: process.env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY,
    previousKeys: previous,
  };
}

async function readConfiguration(
  client: Pick<PoolClient, "query">,
  provider: ProviderName,
  environment: ProviderContext,
): Promise<StoredProviderConfiguration | null> {
  const configuration = await client.query<{
    id: string;
    provider: ProviderName;
    environment: ProviderContext;
    enabled: boolean;
    validationStatus: "NOT_VALIDATED" | "VALID" | "INVALID";
    senderName: string | null;
    senderEmail: string | null;
    supportEmail: string | null;
  }>(
    `SELECT "id", "provider"::text AS "provider", "environment"::text AS "environment",
            "enabled", "validationStatus"::text AS "validationStatus",
            "senderName", "senderEmail", "supportEmail"
       FROM "ExternalProviderConfiguration"
      WHERE "provider" = $1::"ExternalProvider" AND "environment" = $2::"ProviderEnvironment"
      LIMIT 1`,
    [provider, environment],
  );
  const row = configuration.rows[0];
  if (!row) return null;
  const credentials = await client.query<{
    credentialType: ProviderCredentialKind;
    encryptedValue: string;
    encryptionKeyVersion: number;
    maskedHint: string;
  }>(
    `SELECT "credentialType"::text AS "credentialType", "encryptedValue",
            "encryptionKeyVersion", "maskedHint"
       FROM "ExternalProviderCredential"
      WHERE "configurationId" = $1 AND "revokedAt" IS NULL
      ORDER BY "credentialType" ASC`,
    [row.id],
  );
  return { ...row, credentials: credentials.rows };
}

const store: ProviderConfigurationStore = {
  async get(provider, environment) {
    return readConfiguration(getPostgresPool(), provider, environment);
  },

  async saveConfiguration(input) {
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      const existing = await readConfiguration(client, input.provider, input.environment);
      const id = existing?.id ?? randomUUID();
      if (existing) {
        await client.query(
          `UPDATE "ExternalProviderConfiguration"
              SET "senderName" = COALESCE($2, "senderName"),
                  "senderEmail" = COALESCE($3, "senderEmail"),
                  "supportEmail" = COALESCE($4, "supportEmail"),
                  "validationStatus" = 'NOT_VALIDATED', "lastValidationCode" = NULL,
                  "lastValidatedAt" = NULL, "lastRotatedAt" = $5,
                  "updatedByUserId" = $6, "updatedAt" = NOW()
            WHERE "id" = $1`,
          [id, input.senderName ?? null, input.senderEmail ?? null, input.supportEmail ?? null, input.rotatedAt, input.actorId],
        );
      } else {
        await client.query(
          `INSERT INTO "ExternalProviderConfiguration"
             ("id", "provider", "environment", "enabled", "senderName", "senderEmail", "supportEmail",
              "metadata", "validationStatus", "lastRotatedAt", "createdByUserId", "updatedByUserId", "createdAt", "updatedAt")
           VALUES ($1, $2::"ExternalProvider", $3::"ProviderEnvironment", false, $4, $5, $6,
                   '{}'::jsonb, 'NOT_VALIDATED', $7, $8, $8, NOW(), NOW())`,
          [id, input.provider, input.environment, input.senderName ?? null, input.senderEmail ?? null, input.supportEmail ?? null, input.rotatedAt, input.actorId],
        );
      }

      for (const replacement of input.replacements) {
        const prior = await client.query<{ id: string }>(
          `SELECT "id" FROM "ExternalProviderCredential"
            WHERE "configurationId" = $1 AND "credentialType" = $2::"ProviderCredentialType" AND "revokedAt" IS NULL
            FOR UPDATE`,
          [id, replacement.credentialType],
        );
        const credentialId = randomUUID();
        if (prior.rows[0]) {
          await client.query(
            `UPDATE "ExternalProviderCredential" SET "revokedAt" = $2 WHERE "id" = $1`,
            [prior.rows[0].id, input.rotatedAt],
          );
        }
        await client.query(
          `INSERT INTO "ExternalProviderCredential"
             ("id", "configurationId", "credentialType", "encryptedValue", "encryptionKeyVersion",
              "maskedHint", "createdAt", "activatedAt", "createdByUserId")
           VALUES ($1, $2, $3::"ProviderCredentialType", $4, $5, $6, NOW(), NOW(), $7)`,
          [credentialId, id, replacement.credentialType, replacement.encryptedValue, replacement.encryptionKeyVersion, replacement.maskedHint, input.actorId],
        );
        if (prior.rows[0]) {
          await client.query(
            `UPDATE "ExternalProviderCredential" SET "replacedByCredentialId" = $2 WHERE "id" = $1`,
            [prior.rows[0].id, credentialId],
          );
        }
      }
      await client.query("COMMIT");
      return { id };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },

  async setEnabled(input) {
    await getPostgresPool().query(
      `UPDATE "ExternalProviderConfiguration" SET "enabled" = $2, "updatedByUserId" = $3, "updatedAt" = NOW() WHERE "id" = $1`,
      [input.id, input.enabled, input.actorId],
    );
  },

  async revokeCredentials(input) {
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE "ExternalProviderCredential" SET "revokedAt" = $2 WHERE "configurationId" = $1 AND "revokedAt" IS NULL`,
        [input.id, input.revokedAt],
      );
      await client.query(
        `UPDATE "ExternalProviderConfiguration"
            SET "enabled" = false, "validationStatus" = 'NOT_VALIDATED', "lastValidationCode" = NULL,
                "lastValidatedAt" = NULL, "updatedByUserId" = $2, "updatedAt" = NOW()
          WHERE "id" = $1`,
        [input.id, input.actorId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },

  async recordValidation(input) {
    await getPostgresPool().query(
      `UPDATE "ExternalProviderConfiguration"
          SET "validationStatus" = $2::"ProviderValidationStatus", "lastValidationCode" = $3,
              "lastValidatedAt" = $4, "updatedByUserId" = $5, "updatedAt" = NOW()
        WHERE "id" = $1`,
      [input.id, input.status, input.code, input.validatedAt, input.actorId],
    );
  },
};

async function validateResponse(response: Response) {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) throw new Error("PROVIDER_AUTH_FAILED");
  throw new Error("PROVIDER_VALIDATION_FAILED");
}

const validation = {
  async validatePayMongo({ secretKey }: { secretKey: string }) {
    try {
      await validateResponse(await fetch("https://api.paymongo.com/v1/payment_methods", {
        headers: { authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}` },
        signal: AbortSignal.timeout(5000),
      }));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("PROVIDER_")) throw error;
      throw new Error("PROVIDER_DEPENDENCY_UNAVAILABLE");
    }
  },
  async validateResend({ apiKey }: { apiKey: string }) {
    try {
      await validateResponse(await fetch("https://api.resend.com/domains", {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      }));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("PROVIDER_")) throw error;
      throw new Error("PROVIDER_DEPENDENCY_UNAVAILABLE");
    }
  },
};

const securityType: Partial<Record<ProviderOperationalEvent["action"], string>> = {
  PROVIDER_CREDENTIALS_REPLACED: "PROVIDER_CREDENTIAL_REPLACED",
  PROVIDER_CREDENTIALS_REVOKED: "PROVIDER_CREDENTIAL_REVOKED",
  PROVIDER_VALIDATION_SUCCEEDED: "PROVIDER_VALIDATION_SUCCEEDED",
  PROVIDER_VALIDATION_FAILED: "PROVIDER_VALIDATION_FAILED",
  LIVE_PAYMENT_ENABLE_BLOCKED: "LIVE_PAYMENT_ENABLE_BLOCKED",
};

async function emit(event: ProviderOperationalEvent) {
  await audit({
    actorId: event.actorId,
    action: event.action,
    targetType: "ExternalProviderConfiguration",
    targetId: event.configurationId,
    metadata: { provider: event.provider, environment: event.environment, code: event.code ?? null, credentialTypes: event.credentialTypes?.join(",") ?? null },
  });

  const type = securityType[event.action];
  if (type) {
    const definition = securityEventDefinition(type as Parameters<typeof securityEventDefinition>[0]);
    await getPostgresPool().query(
      `INSERT INTO "SecurityEvent" ("id", "userId", "type", "outcome", "severity", "provider", "metadata", "createdAt")
       VALUES ($1, $2, $3::"SecurityEventType", $4::"SecurityEventOutcome", $5::"SecurityEventSeverity", $6::"ExternalProvider", $7::jsonb, NOW())`,
      [randomUUID(), event.actorId, type, definition.outcome, definition.severity, event.provider,
       JSON.stringify({ environment: event.environment, ...(event.code ? { result: event.code } : {}) })],
    );
  }

  if (event.action === "PROVIDER_CREDENTIALS_REPLACED" || event.action === "PROVIDER_CREDENTIALS_REVOKED") {
    const recipient = process.env.SUPPORT_EMAIL?.trim() || "support@jl-bke.com";
    const deduplicationKey = `provider:${event.action}:${event.configurationId ?? `${event.provider}:${event.environment}`}:${Date.now()}`;
    await getPostgresPool().query(
      `INSERT INTO "EmailOutbox" ("id", "type", "recipient", "subject", "payload", "status", "attempts", "deduplicationKey", "createdAt")
       VALUES ($1, 'PROVIDER_CONFIGURATION_CHANGED', $2, $3, $4::jsonb, 'PENDING', 0, $5, NOW())
       ON CONFLICT ("deduplicationKey") DO NOTHING`,
      [randomUUID(), recipient, "BKE provider configuration changed", JSON.stringify({ provider: event.provider, environment: event.environment, action: event.action }), deduplicationKey],
    );
  }
}

const platform = createProviderConfigurationPlatform({ store, runtime: runtime(), keyRing: keyRing(), validation, events: { emit } });

export function saveProviderConfiguration(input: Parameters<typeof platform.saveConfiguration>[0]) { return platform.saveConfiguration(input); }
export function setProviderState(input: Parameters<typeof platform.setState>[0]) { return platform.setState(input); }
export function revokeProviderCredentials(input: Parameters<typeof platform.revokeCredentials>[0]) { return platform.revokeCredentials(input); }
export function validateProviderConfiguration(input: Parameters<typeof platform.validateConfiguration>[0]) { return platform.validateConfiguration(input); }
export function resolvePayMongoConfiguration() { return platform.resolvePayMongo(); }
export function resolveResendConfiguration() { return platform.resolveResend(); }

export async function safeProviderStatuses() {
  const pool = getPostgresPool();
  const configs = await pool.query<{
    id: string; provider: ProviderName; environment: ProviderContext; enabled: boolean;
    senderName: string | null; senderEmail: string | null; supportEmail: string | null;
    validationStatus: string; lastValidationCode: string | null; lastValidatedAt: Date | null; lastRotatedAt: Date | null;
  }>(`SELECT "id", "provider"::text AS "provider", "environment"::text AS "environment", "enabled",
             "senderName", "senderEmail", "supportEmail", "validationStatus"::text AS "validationStatus",
             "lastValidationCode", "lastValidatedAt", "lastRotatedAt"
        FROM "ExternalProviderConfiguration" ORDER BY "provider" ASC, "environment" ASC`);
  const credentials = await pool.query<{ configurationId: string; credentialType: string; maskedHint: string; createdAt: Date }>(
    `SELECT "configurationId", "credentialType"::text AS "credentialType", "maskedHint", "createdAt"
       FROM "ExternalProviderCredential" WHERE "revokedAt" IS NULL ORDER BY "createdAt" ASC`,
  );
  const [success, failure] = await Promise.all([
    pool.query<{ sentAt: Date }>(`SELECT "sentAt" FROM "EmailOutbox" WHERE "status" = 'SENT' ORDER BY "sentAt" DESC NULLS LAST LIMIT 1`),
    pool.query<{ createdAt: Date; lastError: string }>(`SELECT "createdAt", "lastError" FROM "EmailOutbox"
      WHERE "status" IN ('FAILED','PERMANENTLY_FAILED') AND "lastError" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1`),
  ]);
  const sentAt = success.rows[0]?.sentAt ?? null;
  const failed = failure.rows[0] ?? null;
  return configs.rows.map((config) => {
    const activeCredentials = credentials.rows.filter((credential) => credential.configurationId === config.id)
      .map(({ credentialType, maskedHint, createdAt }) => ({ credentialType, maskedHint, createdAt }));
    return config.provider === "RESEND" ? {
      ...config, credentials: activeCredentials,
      deliveryHealth: failed && (!sentAt || failed.createdAt > sentAt) ? "DEGRADED" : sentAt ? "HEALTHY" : "UNKNOWN",
      lastSuccessfulDeliveryAt: sentAt,
      lastDeliveryFailureCategory: failed?.lastError ?? null,
      lastDeliveryFailureAt: failed?.createdAt ?? null,
    } : {
      ...config, credentials: activeCredentials,
      deliveryHealth: null, lastSuccessfulDeliveryAt: null, lastDeliveryFailureCategory: null, lastDeliveryFailureAt: null,
    };
  });
}

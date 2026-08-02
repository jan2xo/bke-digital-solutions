import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { decryptProviderCredential, encryptProviderCredential, providerCredentialHint } from "@/lib/provider-config/crypto";
import { resolveProviderSource } from "@/lib/provider-config/policy";
import type { ProviderContext, ProviderCredentialKind, ProviderName, ResolvedPayMongoConfiguration, ResolvedResendConfiguration } from "@/lib/provider-config/types";

const credentialsFor = {
  PAYMONGO: ["SECRET_KEY", "WEBHOOK_SECRET"],
  RESEND: ["API_KEY"],
} as const satisfies Record<ProviderName, readonly ProviderCredentialKind[]>;

function keyMaterial(version: number) {
  if (version === env.PROVIDER_CREDENTIALS_KEY_VERSION && env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY) return env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY;
  try {
    const previous = JSON.parse(env.PROVIDER_CREDENTIALS_PREVIOUS_KEYS ?? "{}") as Record<string, string>;
    const key = previous[String(version)];
    if (key) return key;
  } catch {}
  throw new Error("PROVIDER_CREDENTIAL_DECRYPT_FAILED");
}

function desiredContext(): ProviderContext {
  if (env.PAYMONGO_LIVEMODE) {
    if (env.DEPLOYMENT_ENV !== "production" || env.LOCAL_PRODUCTION_SIMULATION) throw new Error("PROVIDER_LIVE_MODE_FORBIDDEN");
    return "LIVE";
  }
  return "TEST";
}

async function databaseConfiguration(provider: ProviderName, environment: ProviderContext) {
  const configuration = await db.externalProviderConfiguration.findUnique({
    where: { provider_environment: { provider, environment } },
    include: { credentials: { where: { revokedAt: null }, select: { credentialType: true, encryptedValue: true, encryptionKeyVersion: true } } },
  });
  if (!configuration) throw new Error("PROVIDER_CONFIG_NOT_FOUND");
  if (!configuration.enabled) throw new Error("PROVIDER_CONFIG_DISABLED");
  const values = new Map(configuration.credentials.map((credential) => [credential.credentialType, decryptProviderCredential(credential.encryptedValue, keyMaterial(credential.encryptionKeyVersion), credential.encryptionKeyVersion)]));
  for (const kind of credentialsFor[provider]) if (!values.has(kind)) throw new Error("PROVIDER_CREDENTIAL_MISSING");
  return { configuration, values };
}

function environmentPayMongo(): ResolvedPayMongoConfiguration {
  if (!env.PAYMONGO_SECRET_KEY || !env.PAYMONGO_WEBHOOK_SECRET) throw new Error("PROVIDER_CREDENTIAL_MISSING");
  if (!env.PAYMONGO_LIVEMODE && !env.PAYMONGO_SECRET_KEY.startsWith("sk_test_")) throw new Error("PROVIDER_ENVIRONMENT_MISMATCH");
  if (env.PAYMONGO_LIVEMODE && !env.PAYMONGO_SECRET_KEY.startsWith("sk_live_")) throw new Error("PROVIDER_ENVIRONMENT_MISMATCH");
  desiredContext();
  return { source: "environment", secretKey: env.PAYMONGO_SECRET_KEY, webhookSecret: env.PAYMONGO_WEBHOOK_SECRET, livemode: env.PAYMONGO_LIVEMODE };
}

function parseSender(value: string) {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return match ? { name: match[1] || "BKE Digital Solutions", email: match[2] } : { name: "BKE Digital Solutions", email: value };
}

function environmentResend(): ResolvedResendConfiguration {
  if (!env.RESEND_API_KEY) throw new Error("PROVIDER_CREDENTIAL_MISSING");
  const sender = parseSender(env.EMAIL_FROM);
  return { source: "environment", apiKey: env.RESEND_API_KEY, senderName: sender.name, senderEmail: sender.email, supportEmail: env.SUPPORT_EMAIL };
}

async function withPolicy<T>(database: () => Promise<T>, environment: () => T) {
  return resolveProviderSource({ source: env.PROVIDER_CONFIG_SOURCE, allowEnvironmentFallback: env.PROVIDER_CONFIG_ALLOW_ENV_FALLBACK, database, environment });
}

export async function resolvePayMongoConfiguration(): Promise<ResolvedPayMongoConfiguration> {
  const context = desiredContext();
  return withPolicy(async () => {
    const { values } = await databaseConfiguration("PAYMONGO", context);
    const secretKey = values.get("SECRET_KEY")!;
    if (context === "TEST" && !secretKey.startsWith("sk_test_")) throw new Error("PROVIDER_ENVIRONMENT_MISMATCH");
    if (context === "LIVE" && !secretKey.startsWith("sk_live_")) throw new Error("PROVIDER_ENVIRONMENT_MISMATCH");
    return { source: "database", secretKey, webhookSecret: values.get("WEBHOOK_SECRET")!, livemode: context === "LIVE" };
  }, environmentPayMongo);
}

export async function resolveResendConfiguration(): Promise<ResolvedResendConfiguration> {
  return withPolicy(async () => {
    const { configuration, values } = await databaseConfiguration("RESEND", "LIVE");
    if (!configuration.senderEmail || !configuration.senderName || !configuration.supportEmail) throw new Error("PROVIDER_CONFIG_NOT_FOUND");
    return { source: "database", apiKey: values.get("API_KEY")!, senderName: configuration.senderName, senderEmail: configuration.senderEmail, supportEmail: configuration.supportEmail };
  }, environmentResend);
}

export async function saveProviderConfiguration(input: { actorId: string; provider: ProviderName; environment: ProviderContext; secrets: Partial<Record<ProviderCredentialKind, string>>; senderName?: string; senderEmail?: string; supportEmail?: string }) {
  if (input.provider === "PAYMONGO" && input.environment === "LIVE" && (env.DEPLOYMENT_ENV !== "production" || env.LOCAL_PRODUCTION_SIMULATION)) throw new Error("PROVIDER_LIVE_MODE_FORBIDDEN");
  const required = credentialsFor[input.provider];
  const allowed = new Set(required);
  if (Object.keys(input.secrets).some((kind) => !allowed.has(kind as ProviderCredentialKind))) throw new Error("PROVIDER_CREDENTIAL_INVALID");
  const material = env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY;
  if (!material) throw new Error("PROVIDER_SOURCE_UNAVAILABLE");
  return db.$transaction(async (tx) => {
    const configuration = await tx.externalProviderConfiguration.upsert({
      where: { provider_environment: { provider: input.provider, environment: input.environment } },
      create: { provider: input.provider, environment: input.environment, senderName: input.senderName, senderEmail: input.senderEmail, supportEmail: input.supportEmail, createdByUserId: input.actorId, updatedByUserId: input.actorId },
      update: { senderName: input.senderName, senderEmail: input.senderEmail, supportEmail: input.supportEmail, updatedByUserId: input.actorId, validationStatus: "NOT_VALIDATED", lastValidationCode: null },
    });
    for (const [kind, raw] of Object.entries(input.secrets) as [ProviderCredentialKind, string][]) {
      if (!raw) continue;
      const old = await tx.externalProviderCredential.findFirst({ where: { configurationId: configuration.id, credentialType: kind, revokedAt: null }, select: { id: true } });
      if (old) await tx.externalProviderCredential.update({ where: { id: old.id }, data: { revokedAt: new Date() } });
      const replacement = await tx.externalProviderCredential.create({ data: { configurationId: configuration.id, credentialType: kind, encryptedValue: encryptProviderCredential(raw, material, env.PROVIDER_CREDENTIALS_KEY_VERSION), encryptionKeyVersion: env.PROVIDER_CREDENTIALS_KEY_VERSION, maskedHint: providerCredentialHint(raw), createdByUserId: input.actorId } });
      if (old) await tx.externalProviderCredential.update({ where: { id: old.id }, data: { replacedByCredentialId: replacement.id } });
    }
    await tx.externalProviderConfiguration.update({ where: { id: configuration.id }, data: { lastRotatedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "PROVIDER_CREDENTIALS_REPLACED", targetType: "ExternalProviderConfiguration", targetId: configuration.id, metadata: { provider: input.provider, environment: input.environment, credentialTypes: Object.keys(input.secrets) } } });
    return configuration.id;
  }, { isolationLevel: "Serializable" });
}

export async function setProviderState(input: { actorId: string; provider: ProviderName; environment: ProviderContext; enabled: boolean }) {
  if (input.enabled && input.provider === "PAYMONGO" && input.environment === "LIVE" && (env.DEPLOYMENT_ENV !== "production" || env.LOCAL_PRODUCTION_SIMULATION)) throw new Error("PROVIDER_LIVE_MODE_FORBIDDEN");
  return db.$transaction(async (tx) => {
    const config = await tx.externalProviderConfiguration.findUniqueOrThrow({ where: { provider_environment: { provider: input.provider, environment: input.environment } }, include: { credentials: { where: { revokedAt: null } } } });
    if (input.enabled && (config.validationStatus !== "VALID" || credentialsFor[input.provider].some((kind) => !config.credentials.some((credential) => credential.credentialType === kind)))) throw new Error("PROVIDER_CREDENTIAL_INVALID");
    await tx.externalProviderConfiguration.update({ where: { id: config.id }, data: { enabled: input.enabled, updatedByUserId: input.actorId } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: input.enabled ? "PROVIDER_ENABLED" : "PROVIDER_DISABLED", targetType: "ExternalProviderConfiguration", targetId: config.id, metadata: { provider: input.provider, environment: input.environment } } });
  });
}

export async function revokeProviderCredentials(input: { actorId: string; provider: ProviderName; environment: ProviderContext }) {
  return db.$transaction(async (tx) => {
    const config = await tx.externalProviderConfiguration.findUniqueOrThrow({ where: { provider_environment: { provider: input.provider, environment: input.environment } } });
    await tx.externalProviderCredential.updateMany({ where: { configurationId: config.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.externalProviderConfiguration.update({ where: { id: config.id }, data: { enabled: false, validationStatus: "NOT_VALIDATED", updatedByUserId: input.actorId } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "PROVIDER_CREDENTIALS_REVOKED", targetType: "ExternalProviderConfiguration", targetId: config.id, metadata: { provider: input.provider, environment: input.environment } } });
  });
}

export async function validateProviderConfiguration(input: { actorId: string; provider: ProviderName; environment: ProviderContext }) {
  const configuration = await db.externalProviderConfiguration.findUnique({ where: { provider_environment: { provider: input.provider, environment: input.environment } }, include: { credentials: { where: { revokedAt: null } } } });
  if (!configuration) throw new Error("PROVIDER_CONFIG_NOT_FOUND");
  let code = "PROVIDER_VALIDATION_FAILED";
  try {
    const values = new Map(configuration.credentials.map((credential) => [credential.credentialType, decryptProviderCredential(credential.encryptedValue, keyMaterial(credential.encryptionKeyVersion), credential.encryptionKeyVersion)]));
    for (const kind of credentialsFor[input.provider]) if (!values.get(kind)) throw new Error("PROVIDER_CREDENTIAL_MISSING");
    if (input.provider === "PAYMONGO") {
      const key = values.get("SECRET_KEY")!;
      if (input.environment === "TEST" ? !key.startsWith("sk_test_") : !key.startsWith("sk_live_")) throw new Error("PROVIDER_ENVIRONMENT_MISMATCH");
      if (input.environment === "LIVE" && (env.DEPLOYMENT_ENV !== "production" || env.LOCAL_PRODUCTION_SIMULATION)) throw new Error("PROVIDER_LIVE_MODE_FORBIDDEN");
      if (!values.get("WEBHOOK_SECRET")!.startsWith("whsk_")) throw new Error("PROVIDER_CREDENTIAL_INVALID");
      const response = await fetch("https://api.paymongo.com/v1/payments?limit=1", { headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error("PROVIDER_VALIDATION_FAILED");
    } else {
      if (!values.get("API_KEY")!.startsWith("re_")) throw new Error("PROVIDER_CREDENTIAL_INVALID");
      if (!configuration.senderEmail?.toLowerCase().endsWith("@jl-bke.com")) throw new Error("PROVIDER_CREDENTIAL_INVALID");
      const response = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${values.get("API_KEY")!}` }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error("PROVIDER_VALIDATION_FAILED");
    }
    code = "VALID";
    await db.$transaction([db.externalProviderConfiguration.update({ where: { id: configuration.id }, data: { validationStatus: "VALID", lastValidatedAt: new Date(), lastValidationCode: code, updatedByUserId: input.actorId } }), db.auditLog.create({ data: { actorId: input.actorId, action: "PROVIDER_VALIDATION_SUCCEEDED", targetType: "ExternalProviderConfiguration", targetId: configuration.id, metadata: { provider: input.provider, environment: input.environment, resultCode: code } } })]);
    return { valid: true as const, code };
  } catch (error) {
    code = error instanceof Error && error.message.startsWith("PROVIDER_") ? error.message : "PROVIDER_VALIDATION_FAILED";
    await db.$transaction([db.externalProviderConfiguration.update({ where: { id: configuration.id }, data: { validationStatus: "INVALID", lastValidatedAt: new Date(), lastValidationCode: code, updatedByUserId: input.actorId } }), db.auditLog.create({ data: { actorId: input.actorId, action: "PROVIDER_VALIDATION_FAILED", targetType: "ExternalProviderConfiguration", targetId: configuration.id, metadata: { provider: input.provider, environment: input.environment, resultCode: code } } })]);
    return { valid: false as const, code };
  }
}

export async function safeProviderStatuses() {
  return db.externalProviderConfiguration.findMany({ select: { id: true, provider: true, environment: true, enabled: true, senderName: true, senderEmail: true, supportEmail: true, validationStatus: true, lastValidationCode: true, lastValidatedAt: true, lastRotatedAt: true, credentials: { where: { revokedAt: null }, select: { credentialType: true, maskedHint: true, createdAt: true } } }, orderBy: [{ provider: "asc" }, { environment: "asc" }] });
}

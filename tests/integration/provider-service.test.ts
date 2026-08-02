import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: {
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: "test",
  DEPLOYMENT_ENV: "staging",
  LOCAL_PRODUCTION_SIMULATION: true,
  PAYMONGO_LIVEMODE: false,
  PROVIDER_CONFIG_SOURCE: "database",
  PROVIDER_CONFIG_ALLOW_ENV_FALLBACK: false,
  PROVIDER_CREDENTIALS_ENCRYPTION_KEY: "integration-provider-master-key-material-2026-that-is-not-production",
  PROVIDER_CREDENTIALS_KEY_VERSION: 7,
  PROVIDER_CREDENTIALS_PREVIOUS_KEYS: undefined,
  PAYMONGO_SECRET_KEY: undefined,
  PAYMONGO_WEBHOOK_SECRET: undefined,
  RESEND_API_KEY: undefined,
  EMAIL_FROM: "BKE Digital Solutions <noreply@jl-bke.com>",
  SUPPORT_EMAIL: "support@jl-bke.com",
} }));

describe.sequential("database provider configuration service", () => {
  let actorId = "";
  let db: typeof import("@/lib/db")["db"];
  let service: typeof import("@/lib/provider-config/service");
  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    service = await import("@/lib/provider-config/service");
    actorId = (await db.user.create({ data: { email: `provider-service-${Date.now()}@bke.test`, role: "ADMIN", emailVerified: new Date() } })).id;
  });
  afterAll(async () => {
    await db.externalProviderConfiguration.deleteMany({ where: { createdByUserId: actorId } });
    await db.emailOutbox.deleteMany({ where: { recipient: { startsWith: "provider-service-" } } });
    await db.securityEvent.deleteMany({ where: { userId: actorId } });
    await db.user.delete({ where: { id: actorId } });
    await db.$disconnect();
  });

  it("saves, validates, enables, resolves, and atomically replaces PayMongo test credentials", async () => {
    await service.saveProviderConfiguration({ actorId, provider: "PAYMONGO", environment: "TEST", secrets: { SECRET_KEY: "sk_test_database_initial_credential", WEBHOOK_SECRET: "whsk_database_initial_credential" } });
    const config = await db.externalProviderConfiguration.findUniqueOrThrow({ where: { provider_environment: { provider: "PAYMONGO", environment: "TEST" } }, include: { credentials: true } });
    expect(config.credentials).toHaveLength(2);
    expect(config.credentials.every((credential) => !credential.encryptedValue.includes("database_initial"))).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));
    expect(await service.validateProviderConfiguration({ actorId, provider: "PAYMONGO", environment: "TEST" })).toEqual({ valid: true, code: "VALID" });
    await service.setProviderState({ actorId, provider: "PAYMONGO", environment: "TEST", enabled: true });
    expect(await service.resolvePayMongoConfiguration()).toMatchObject({ source: "database", secretKey: "sk_test_database_initial_credential", livemode: false });
    await service.saveProviderConfiguration({ actorId, provider: "PAYMONGO", environment: "TEST", secrets: { SECRET_KEY: "sk_test_database_replacement_credential" } });
    const credentials = await db.externalProviderCredential.findMany({ where: { configurationId: config.id, credentialType: "SECRET_KEY" }, orderBy: { createdAt: "asc" } });
    expect(credentials).toHaveLength(2);
    expect(credentials[0]?.revokedAt).not.toBeNull();
    expect(credentials[0]?.replacedByCredentialId).toBe(credentials[1]?.id);
    expect(await db.auditLog.count({ where: { actorId, targetId: config.id, action: { startsWith: "PROVIDER_" } } })).toBeGreaterThanOrEqual(4);
  });

  it("validates and resolves Resend without applying the PayMongo live-mode lock", async () => {
    await service.saveProviderConfiguration({ actorId, provider: "RESEND", environment: "LIVE", secrets: { API_KEY: "re_database_resend_credential" }, senderName: "BKE Digital Solutions", senderEmail: "noreply@jl-bke.com", supportEmail: "support@jl-bke.com" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));
    expect(await service.validateProviderConfiguration({ actorId, provider: "RESEND", environment: "LIVE" })).toEqual({ valid: true, code: "VALID" });
    await service.setProviderState({ actorId, provider: "RESEND", environment: "LIVE", enabled: true });
    expect(await service.resolveResendConfiguration()).toMatchObject({ source: "database", apiKey: "re_database_resend_credential", senderEmail: "noreply@jl-bke.com" });
    await service.revokeProviderCredentials({ actorId, provider: "RESEND", environment: "LIVE" });
    await expect(service.resolveResendConfiguration()).rejects.toThrow("PROVIDER_CONFIG_DISABLED");
  });
});

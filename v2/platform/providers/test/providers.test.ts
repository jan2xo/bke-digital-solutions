import { describe, expect, it, vi } from "vitest";
import {
  createProviderConfigurationPlatform,
  decryptProviderCredential,
  encryptProviderCredential,
  providerCredentialHint,
  resolveProviderSource,
} from "../index";
import type {
  ProviderConfigurationStore,
  ProviderOperationalEvent,
  ProviderRuntimeEnvironment,
  StoredProviderConfiguration,
} from "../index";

const key = "0123456789abcdef0123456789abcdef";

function runtime(overrides: Partial<ProviderRuntimeEnvironment> = {}): ProviderRuntimeEnvironment {
  return {
    source: "database",
    allowEnvironmentFallback: false,
    deploymentEnvironment: "production",
    localProductionSimulation: false,
    payMongoLivemode: false,
    payMongoSecretKey: "sk_test_environment",
    payMongoWebhookSecret: "whsk_environment",
    resendApiKey: "re_environment",
    emailFrom: "BKE Digital Solutions <support@jl-bke.com>",
    supportEmail: "support@jl-bke.com",
    ...overrides,
  };
}

function payMongoConfiguration(
  overrides: Partial<StoredProviderConfiguration> = {},
): StoredProviderConfiguration {
  return {
    id: "paymongo-test",
    provider: "PAYMONGO",
    environment: "TEST",
    enabled: true,
    validationStatus: "VALID",
    credentials: [
      {
        credentialType: "SECRET_KEY",
        encryptedValue: encryptProviderCredential("sk_test_database", key, 1),
        encryptionKeyVersion: 1,
      },
      {
        credentialType: "WEBHOOK_SECRET",
        encryptedValue: encryptProviderCredential("whsk_database", key, 1),
        encryptionKeyVersion: 1,
      },
    ],
    ...overrides,
  };
}

function resendConfiguration(
  overrides: Partial<StoredProviderConfiguration> = {},
): StoredProviderConfiguration {
  return {
    id: "resend-live",
    provider: "RESEND",
    environment: "LIVE",
    enabled: true,
    validationStatus: "VALID",
    senderName: "BKE",
    senderEmail: "support@jl-bke.com",
    supportEmail: "support@jl-bke.com",
    credentials: [
      {
        credentialType: "API_KEY",
        encryptedValue: encryptProviderCredential("re_database", key, 1),
        encryptionKeyVersion: 1,
      },
    ],
    ...overrides,
  };
}

function store(
  get: ProviderConfigurationStore["get"] = async () => null,
): ProviderConfigurationStore {
  return {
    get,
    saveConfiguration: vi.fn(async () => ({ id: "configuration-1" })),
    setEnabled: vi.fn(async () => undefined),
    revokeCredentials: vi.fn(async () => undefined),
    recordValidation: vi.fn(async () => undefined),
  };
}

describe("V2 platform provider configuration", () => {
  it("preserves encrypted credential format, AAD/version binding, and safe hints", () => {
    const encrypted = encryptProviderCredential("sk_test_super_secret", key, 1);
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("sk_test_super_secret");
    expect(decryptProviderCredential(encrypted, key, 1)).toBe("sk_test_super_secret");
    expect(() => decryptProviderCredential(encrypted, `${key}x`, 1)).toThrow(
      "PROVIDER_CREDENTIAL_DECRYPT_FAILED",
    );
    expect(providerCredentialHint("sk_test_super_secret")).toBe("sk_t••••cret");
    expect(providerCredentialHint("short")).toBe("••••");
  });

  it("preserves database-first source policy with explicit environment fallback", async () => {
    await expect(
      resolveProviderSource({
        source: "database",
        allowEnvironmentFallback: true,
        database: async () => { throw new Error("PROVIDER_CONFIG_NOT_FOUND"); },
        environment: () => "environment-value",
      }),
    ).resolves.toBe("environment-value");

    await expect(
      resolveProviderSource({
        source: "database",
        allowEnvironmentFallback: false,
        database: async () => { throw new Error("PROVIDER_CONFIG_NOT_FOUND"); },
        environment: () => "environment-value",
      }),
    ).rejects.toThrow("PROVIDER_CONFIG_NOT_FOUND");
  });

  it("resolves encrypted database PayMongo and Resend configurations without exposing storage", async () => {
    const persistence = store(async (provider, environment) =>
      provider === "PAYMONGO" && environment === "TEST"
        ? payMongoConfiguration()
        : provider === "RESEND" && environment === "LIVE"
          ? resendConfiguration()
          : null,
    );
    const platform = createProviderConfigurationPlatform({
      store: persistence,
      runtime: runtime(),
      keyRing: { currentVersion: 1, currentKey: key },
      validation: {
        validatePayMongo: async () => undefined,
        validateResend: async () => undefined,
      },
    });

    await expect(platform.resolvePayMongo()).resolves.toEqual({
      source: "database",
      secretKey: "sk_test_database",
      webhookSecret: "whsk_database",
      livemode: false,
    });
    await expect(platform.resolveResend()).resolves.toEqual({
      source: "database",
      apiKey: "re_database",
      senderName: "BKE",
      senderEmail: "support@jl-bke.com",
      supportEmail: "support@jl-bke.com",
    });
  });

  it("fails closed on forbidden live PayMongo and emits only safe blocked metadata", async () => {
    const events: ProviderOperationalEvent[] = [];
    const persistence = store(async () => payMongoConfiguration({
      id: "paymongo-live",
      environment: "LIVE",
    }));
    const platform = createProviderConfigurationPlatform({
      store: persistence,
      runtime: runtime({
        deploymentEnvironment: "staging",
        payMongoLivemode: true,
      }),
      keyRing: { currentVersion: 1, currentKey: key },
      validation: {
        validatePayMongo: async () => undefined,
        validateResend: async () => undefined,
      },
      events: { emit: async (event) => void events.push(event) },
    });

    await expect(
      platform.setState({
        actorId: "admin-1",
        provider: "PAYMONGO",
        environment: "LIVE",
        enabled: true,
      }),
    ).rejects.toThrow("PROVIDER_LIVE_MODE_FORBIDDEN");
    expect(persistence.setEnabled).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        action: "LIVE_PAYMENT_ENABLE_BLOCKED",
        actorId: "admin-1",
        provider: "PAYMONGO",
        environment: "LIVE",
      },
    ]);
  });

  it("encrypts replacements before storage and never emits raw credential values", async () => {
    const persistence = store();
    const events: ProviderOperationalEvent[] = [];
    const fixed = new Date("2026-09-05T01:30:00.000Z");
    const platform = createProviderConfigurationPlatform({
      store: persistence,
      runtime: runtime(),
      keyRing: { currentVersion: 1, currentKey: key },
      validation: {
        validatePayMongo: async () => undefined,
        validateResend: async () => undefined,
      },
      events: { emit: async (event) => void events.push(event) },
      now: () => fixed,
    });

    await expect(
      platform.saveConfiguration({
        actorId: "admin-1",
        provider: "RESEND",
        environment: "LIVE",
        secrets: { API_KEY: "re_raw_should_never_leave_crypto_boundary" },
        senderName: "BKE",
        senderEmail: "support@jl-bke.com",
        supportEmail: "support@jl-bke.com",
      }),
    ).resolves.toBe("configuration-1");

    const saved = (persistence.saveConfiguration as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(saved.rotatedAt).toEqual(fixed);
    expect(saved.replacements[0].encryptedValue).not.toContain("re_raw_should_never_leave_crypto_boundary");
    expect(
      decryptProviderCredential(saved.replacements[0].encryptedValue, key, 1),
    ).toBe("re_raw_should_never_leave_crypto_boundary");
    expect(JSON.stringify(events)).not.toContain("re_raw_should_never_leave_crypto_boundary");
    expect(events[0]?.credentialTypes).toEqual(["API_KEY"]);
  });

  it("validates through injected provider clients, records safe status, then permits enablement", async () => {
    let configuration = resendConfiguration({ validationStatus: "NOT_VALIDATED" });
    const persistence = store(async () => configuration);
    persistence.recordValidation = vi.fn(async (input) => {
      configuration = { ...configuration, validationStatus: input.status };
    });
    const validateResend = vi.fn(async () => undefined);
    const events: ProviderOperationalEvent[] = [];
    const platform = createProviderConfigurationPlatform({
      store: persistence,
      runtime: runtime(),
      keyRing: { currentVersion: 1, currentKey: key },
      validation: {
        validatePayMongo: async () => undefined,
        validateResend,
      },
      events: { emit: async (event) => void events.push(event) },
    });

    await expect(
      platform.validateConfiguration({
        actorId: "admin-1",
        provider: "RESEND",
        environment: "LIVE",
      }),
    ).resolves.toEqual({ valid: true, code: "VALID" });
    expect(validateResend).toHaveBeenCalledWith({ apiKey: "re_database" });
    expect(persistence.recordValidation).toHaveBeenCalledWith(
      expect.objectContaining({ status: "VALID", code: "VALID" }),
    );

    await platform.setState({
      actorId: "admin-1",
      provider: "RESEND",
      environment: "LIVE",
      enabled: true,
    });
    expect(persistence.setEnabled).toHaveBeenCalledWith({
      id: "resend-live",
      actorId: "admin-1",
      enabled: true,
    });
    expect(events.map((event) => event.action)).toEqual([
      "PROVIDER_VALIDATION_SUCCEEDED",
      "PROVIDER_ENABLED",
    ]);
  });

  it("revokes credentials through the durable store and emits no secret material", async () => {
    const persistence = store(async () => resendConfiguration());
    const events: ProviderOperationalEvent[] = [];
    const fixed = new Date("2026-09-05T01:31:00.000Z");
    const platform = createProviderConfigurationPlatform({
      store: persistence,
      runtime: runtime(),
      keyRing: { currentVersion: 1, currentKey: key },
      validation: {
        validatePayMongo: async () => undefined,
        validateResend: async () => undefined,
      },
      events: { emit: async (event) => void events.push(event) },
      now: () => fixed,
    });

    await platform.revokeCredentials({
      actorId: "admin-1",
      provider: "RESEND",
      environment: "LIVE",
    });
    expect(persistence.revokeCredentials).toHaveBeenCalledWith({
      id: "resend-live",
      actorId: "admin-1",
      revokedAt: fixed,
    });
    expect(events).toEqual([
      {
        action: "PROVIDER_CREDENTIALS_REVOKED",
        actorId: "admin-1",
        provider: "RESEND",
        environment: "LIVE",
        configurationId: "resend-live",
      },
    ]);
  });
});

import type {
  ProviderConfigurationStore,
  ProviderContext,
  ProviderCredentialKeyRing,
  ProviderCredentialKind,
  ProviderName,
  ProviderOperationalEvent,
  ProviderOperationalEventSink,
  ProviderRuntimeEnvironment,
  ProviderValidationClient,
  ResolvedPayMongoConfiguration,
  ResolvedResendConfiguration,
  StoredProviderConfiguration,
} from "./contracts";
import {
  decryptProviderCredential,
  encryptProviderCredential,
  providerCredentialHint,
} from "./crypto";
import {
  assertLiveProviderAllowed,
  assertProviderCredentialShape,
  desiredPayMongoContext,
  parseProviderSender,
  providerKeyMaterial,
  requiredProviderCredentials,
  resolveProviderSource,
} from "./policy";

export type ProviderConfigurationPlatform = Readonly<{
  resolvePayMongo(): Promise<ResolvedPayMongoConfiguration>;
  resolveResend(): Promise<ResolvedResendConfiguration>;
  saveConfiguration(input: Readonly<{
    actorId: string;
    provider: ProviderName;
    environment: ProviderContext;
    secrets: Partial<Record<ProviderCredentialKind, string>>;
    senderName?: string;
    senderEmail?: string;
    supportEmail?: string;
  }>): Promise<string>;
  setState(input: Readonly<{
    actorId: string;
    provider: ProviderName;
    environment: ProviderContext;
    enabled: boolean;
  }>): Promise<void>;
  revokeCredentials(input: Readonly<{
    actorId: string;
    provider: ProviderName;
    environment: ProviderContext;
  }>): Promise<void>;
  validateConfiguration(input: Readonly<{
    actorId: string;
    provider: ProviderName;
    environment: ProviderContext;
  }>): Promise<Readonly<{ valid: boolean; code: string }>>;
}>;

export function createProviderConfigurationPlatform(dependencies: Readonly<{
  store: ProviderConfigurationStore;
  runtime: ProviderRuntimeEnvironment;
  keyRing: ProviderCredentialKeyRing;
  validation: ProviderValidationClient;
  events?: ProviderOperationalEventSink;
  now?: () => Date;
  resendSenderDomain?: string;
}>): ProviderConfigurationPlatform {
  const clock = dependencies.now ?? (() => new Date());
  const resendSenderDomain = dependencies.resendSenderDomain ?? "jl-bke.com";

  async function emit(event: ProviderOperationalEvent): Promise<void> {
    await dependencies.events?.emit(event);
  }

  async function blockForbiddenLive(
    actorId: string,
    provider: ProviderName,
    environment: ProviderContext,
  ): Promise<void> {
    try {
      assertLiveProviderAllowed(dependencies.runtime, provider, environment);
    } catch (error) {
      await emit({
        action: "LIVE_PAYMENT_ENABLE_BLOCKED",
        actorId,
        provider,
        environment,
      });
      throw error;
    }
  }

  function decryptConfiguration(
    configuration: StoredProviderConfiguration,
  ): Map<ProviderCredentialKind, string> {
    const values = new Map<ProviderCredentialKind, string>();
    for (const credential of configuration.credentials) {
      values.set(
        credential.credentialType,
        decryptProviderCredential(
          credential.encryptedValue,
          providerKeyMaterial(dependencies.keyRing, credential.encryptionKeyVersion),
          credential.encryptionKeyVersion,
        ),
      );
    }
    for (const kind of requiredProviderCredentials[configuration.provider]) {
      if (!values.has(kind)) throw new Error("PROVIDER_CREDENTIAL_MISSING");
    }
    return values;
  }

  async function databaseConfiguration(
    provider: ProviderName,
    environment: ProviderContext,
  ): Promise<Readonly<{
    configuration: StoredProviderConfiguration;
    values: Map<ProviderCredentialKind, string>;
  }>> {
    const configuration = await dependencies.store.get(provider, environment);
    if (!configuration) throw new Error("PROVIDER_CONFIG_NOT_FOUND");
    if (!configuration.enabled) throw new Error("PROVIDER_CONFIG_DISABLED");
    return { configuration, values: decryptConfiguration(configuration) };
  }

  function environmentPayMongo(): ResolvedPayMongoConfiguration {
    const runtime = dependencies.runtime;
    if (!runtime.payMongoSecretKey || !runtime.payMongoWebhookSecret) {
      throw new Error("PROVIDER_CREDENTIAL_MISSING");
    }
    const context = desiredPayMongoContext(runtime);
    const values = new Map<ProviderCredentialKind, string>([
      ["SECRET_KEY", runtime.payMongoSecretKey],
      ["WEBHOOK_SECRET", runtime.payMongoWebhookSecret],
    ]);
    assertProviderCredentialShape("PAYMONGO", context, values);
    return {
      source: "environment",
      secretKey: runtime.payMongoSecretKey,
      webhookSecret: runtime.payMongoWebhookSecret,
      livemode: context === "LIVE",
    };
  }

  function environmentResend(): ResolvedResendConfiguration {
    const runtime = dependencies.runtime;
    if (!runtime.resendApiKey) throw new Error("PROVIDER_CREDENTIAL_MISSING");
    const sender = parseProviderSender(runtime.emailFrom);
    return {
      source: "environment",
      apiKey: runtime.resendApiKey,
      senderName: sender.name,
      senderEmail: sender.email,
      supportEmail: runtime.supportEmail,
    };
  }

  async function resolvePayMongo(): Promise<ResolvedPayMongoConfiguration> {
    const context = desiredPayMongoContext(dependencies.runtime);
    return resolveProviderSource({
      source: dependencies.runtime.source,
      allowEnvironmentFallback: dependencies.runtime.allowEnvironmentFallback,
      database: async () => {
        const { values } = await databaseConfiguration("PAYMONGO", context);
        assertProviderCredentialShape("PAYMONGO", context, values);
        return {
          source: "database" as const,
          secretKey: values.get("SECRET_KEY")!,
          webhookSecret: values.get("WEBHOOK_SECRET")!,
          livemode: context === "LIVE",
        };
      },
      environment: environmentPayMongo,
    });
  }

  async function resolveResend(): Promise<ResolvedResendConfiguration> {
    return resolveProviderSource({
      source: dependencies.runtime.source,
      allowEnvironmentFallback: dependencies.runtime.allowEnvironmentFallback,
      database: async () => {
        const { configuration, values } = await databaseConfiguration("RESEND", "LIVE");
        if (
          !configuration.senderEmail ||
          !configuration.senderName ||
          !configuration.supportEmail
        ) {
          throw new Error("PROVIDER_CONFIG_NOT_FOUND");
        }
        return {
          source: "database" as const,
          apiKey: values.get("API_KEY")!,
          senderName: configuration.senderName,
          senderEmail: configuration.senderEmail,
          supportEmail: configuration.supportEmail,
        };
      },
      environment: environmentResend,
    });
  }

  async function saveConfiguration(input: Readonly<{
    actorId: string;
    provider: ProviderName;
    environment: ProviderContext;
    secrets: Partial<Record<ProviderCredentialKind, string>>;
    senderName?: string;
    senderEmail?: string;
    supportEmail?: string;
  }>): Promise<string> {
    await blockForbiddenLive(input.actorId, input.provider, input.environment);
    const allowed = new Set<ProviderCredentialKind>(requiredProviderCredentials[input.provider]);
    const entries = Object.entries(input.secrets) as [ProviderCredentialKind, string][];
    if (entries.some(([kind]) => !allowed.has(kind))) {
      throw new Error("PROVIDER_CREDENTIAL_INVALID");
    }
    if (!dependencies.keyRing.currentKey) {
      throw new Error("PROVIDER_SOURCE_UNAVAILABLE");
    }

    const replacements = entries
      .filter(([, raw]) => Boolean(raw))
      .map(([credentialType, raw]) => ({
        credentialType,
        encryptedValue: encryptProviderCredential(
          raw,
          dependencies.keyRing.currentKey!,
          dependencies.keyRing.currentVersion,
        ),
        encryptionKeyVersion: dependencies.keyRing.currentVersion,
        maskedHint: providerCredentialHint(raw),
      }));

    const configuration = await dependencies.store.saveConfiguration({
      actorId: input.actorId,
      provider: input.provider,
      environment: input.environment,
      senderName: input.senderName,
      senderEmail: input.senderEmail,
      supportEmail: input.supportEmail,
      replacements,
      rotatedAt: clock(),
    });
    await emit({
      action: "PROVIDER_CREDENTIALS_REPLACED",
      actorId: input.actorId,
      provider: input.provider,
      environment: input.environment,
      configurationId: configuration.id,
      credentialTypes: replacements.map((replacement) => replacement.credentialType),
    });
    return configuration.id;
  }

  async function setState(input: Readonly<{
    actorId: string;
    provider: ProviderName;
    environment: ProviderContext;
    enabled: boolean;
  }>): Promise<void> {
    if (input.enabled) {
      await blockForbiddenLive(input.actorId, input.provider, input.environment);
    }
    const configuration = await dependencies.store.get(input.provider, input.environment);
    if (!configuration) throw new Error("PROVIDER_CONFIG_NOT_FOUND");
    if (input.enabled) {
      const credentialTypes = new Set(
        configuration.credentials.map((credential) => credential.credentialType),
      );
      if (
        configuration.validationStatus !== "VALID" ||
        requiredProviderCredentials[input.provider].some(
          (kind) => !credentialTypes.has(kind),
        )
      ) {
        throw new Error("PROVIDER_CREDENTIAL_INVALID");
      }
    }
    await dependencies.store.setEnabled({
      id: configuration.id,
      actorId: input.actorId,
      enabled: input.enabled,
    });
    await emit({
      action: input.enabled ? "PROVIDER_ENABLED" : "PROVIDER_DISABLED",
      actorId: input.actorId,
      provider: input.provider,
      environment: input.environment,
      configurationId: configuration.id,
    });
  }

  async function revokeCredentials(input: Readonly<{
    actorId: string;
    provider: ProviderName;
    environment: ProviderContext;
  }>): Promise<void> {
    const configuration = await dependencies.store.get(input.provider, input.environment);
    if (!configuration) throw new Error("PROVIDER_CONFIG_NOT_FOUND");
    await dependencies.store.revokeCredentials({
      id: configuration.id,
      actorId: input.actorId,
      revokedAt: clock(),
    });
    await emit({
      action: "PROVIDER_CREDENTIALS_REVOKED",
      actorId: input.actorId,
      provider: input.provider,
      environment: input.environment,
      configurationId: configuration.id,
    });
  }

  async function validateConfiguration(input: Readonly<{
    actorId: string;
    provider: ProviderName;
    environment: ProviderContext;
  }>): Promise<Readonly<{ valid: boolean; code: string }>> {
    const configuration = await dependencies.store.get(input.provider, input.environment);
    if (!configuration) throw new Error("PROVIDER_CONFIG_NOT_FOUND");

    let code = "PROVIDER_VALIDATION_FAILED";
    try {
      await blockForbiddenLive(input.actorId, input.provider, input.environment);
      const values = decryptConfiguration(configuration);
      assertProviderCredentialShape(
        input.provider,
        input.environment,
        values,
        configuration.senderEmail,
        resendSenderDomain,
      );
      if (input.provider === "PAYMONGO") {
        await dependencies.validation.validatePayMongo({
          secretKey: values.get("SECRET_KEY")!,
        });
      } else {
        await dependencies.validation.validateResend({
          apiKey: values.get("API_KEY")!,
        });
      }
      code = "VALID";
      await dependencies.store.recordValidation({
        id: configuration.id,
        actorId: input.actorId,
        status: "VALID",
        code,
        validatedAt: clock(),
      });
      await emit({
        action: "PROVIDER_VALIDATION_SUCCEEDED",
        actorId: input.actorId,
        provider: input.provider,
        environment: input.environment,
        configurationId: configuration.id,
        code,
      });
      return { valid: true, code };
    } catch (error) {
      code =
        error instanceof Error && error.message.startsWith("PROVIDER_")
          ? error.message
          : "PROVIDER_VALIDATION_FAILED";
      await dependencies.store.recordValidation({
        id: configuration.id,
        actorId: input.actorId,
        status: "INVALID",
        code,
        validatedAt: clock(),
      });
      await emit({
        action: "PROVIDER_VALIDATION_FAILED",
        actorId: input.actorId,
        provider: input.provider,
        environment: input.environment,
        configurationId: configuration.id,
        code,
      });
      return { valid: false, code };
    }
  }

  return Object.freeze({
    resolvePayMongo,
    resolveResend,
    saveConfiguration,
    setState,
    revokeCredentials,
    validateConfiguration,
  });
}

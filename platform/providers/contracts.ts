export type ProviderName = "PAYMONGO" | "RESEND";
export type ProviderContext = "TEST" | "LIVE";
export type ProviderCredentialKind = "SECRET_KEY" | "WEBHOOK_SECRET" | "API_KEY";
export type ProviderConfigurationSource = "environment" | "database";
export type ProviderValidationStatus = "NOT_VALIDATED" | "VALID" | "INVALID";

export type StoredProviderCredential = Readonly<{
  credentialType: ProviderCredentialKind;
  encryptedValue: string;
  encryptionKeyVersion: number;
  maskedHint?: string;
}>;

export type StoredProviderConfiguration = Readonly<{
  id: string;
  provider: ProviderName;
  environment: ProviderContext;
  enabled: boolean;
  validationStatus: ProviderValidationStatus;
  senderName?: string | null;
  senderEmail?: string | null;
  supportEmail?: string | null;
  credentials: readonly StoredProviderCredential[];
}>;

export type EncryptedProviderCredentialReplacement = Readonly<{
  credentialType: ProviderCredentialKind;
  encryptedValue: string;
  encryptionKeyVersion: number;
  maskedHint: string;
}>;

export type ResolvedPayMongoConfiguration = Readonly<{
  source: ProviderConfigurationSource;
  secretKey: string;
  webhookSecret: string;
  livemode: boolean;
}>;

export type ResolvedResendConfiguration = Readonly<{
  source: ProviderConfigurationSource;
  apiKey: string;
  senderName: string;
  senderEmail: string;
  supportEmail: string;
}>;

export type ProviderRuntimeEnvironment = Readonly<{
  source: ProviderConfigurationSource;
  allowEnvironmentFallback: boolean;
  deploymentEnvironment: string;
  localProductionSimulation: boolean;
  payMongoLivemode: boolean;
  payMongoSecretKey?: string;
  payMongoWebhookSecret?: string;
  resendApiKey?: string;
  emailFrom: string;
  supportEmail: string;
}>;

export type ProviderCredentialKeyRing = Readonly<{
  currentVersion: number;
  currentKey?: string;
  previousKeys?: Readonly<Record<number, string>>;
}>;

export interface ProviderConfigurationStore {
  get(provider: ProviderName, environment: ProviderContext): Promise<StoredProviderConfiguration | null>;
  saveConfiguration(input: Readonly<{
    actorId: string;
    provider: ProviderName;
    environment: ProviderContext;
    senderName?: string;
    senderEmail?: string;
    supportEmail?: string;
    replacements: readonly EncryptedProviderCredentialReplacement[];
    rotatedAt: Date;
  }>): Promise<Readonly<{ id: string }>>;
  setEnabled(input: Readonly<{
    id: string;
    actorId: string;
    enabled: boolean;
  }>): Promise<void>;
  revokeCredentials(input: Readonly<{
    id: string;
    actorId: string;
    revokedAt: Date;
  }>): Promise<void>;
  recordValidation(input: Readonly<{
    id: string;
    actorId: string;
    status: "VALID" | "INVALID";
    code: string;
    validatedAt: Date;
  }>): Promise<void>;
}

export interface ProviderValidationClient {
  validatePayMongo(input: Readonly<{ secretKey: string }>): Promise<void>;
  validateResend(input: Readonly<{ apiKey: string }>): Promise<void>;
}

export type ProviderOperationalEvent = Readonly<{
  action:
    | "PROVIDER_CREDENTIALS_REPLACED"
    | "PROVIDER_ENABLED"
    | "PROVIDER_DISABLED"
    | "PROVIDER_CREDENTIALS_REVOKED"
    | "PROVIDER_VALIDATION_SUCCEEDED"
    | "PROVIDER_VALIDATION_FAILED"
    | "LIVE_PAYMENT_ENABLE_BLOCKED";
  actorId: string;
  provider: ProviderName;
  environment: ProviderContext;
  configurationId?: string;
  code?: string;
  credentialTypes?: readonly ProviderCredentialKind[];
}>;

export interface ProviderOperationalEventSink {
  emit(event: ProviderOperationalEvent): Promise<void>;
}

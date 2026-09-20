import type {
  ProviderConfigurationSource,
  ProviderContext,
  ProviderCredentialKeyRing,
  ProviderCredentialKind,
  ProviderName,
  ProviderRuntimeEnvironment,
} from "./contracts";

export const requiredProviderCredentials = {
  PAYMONGO: ["SECRET_KEY", "WEBHOOK_SECRET"],
  RESEND: ["API_KEY"],
} as const satisfies Record<ProviderName, readonly ProviderCredentialKind[]>;

export async function resolveProviderSource<T>(input: Readonly<{
  source: ProviderConfigurationSource;
  allowEnvironmentFallback: boolean;
  database: () => Promise<T>;
  environment: () => T | Promise<T>;
}>): Promise<T> {
  if (input.source === "environment") return input.environment();
  try {
    return await input.database();
  } catch (error) {
    if (input.allowEnvironmentFallback) return input.environment();
    throw error;
  }
}

export function providerKeyMaterial(
  keyRing: ProviderCredentialKeyRing,
  version: number,
): string {
  if (version === keyRing.currentVersion && keyRing.currentKey) {
    return keyRing.currentKey;
  }
  const previous = keyRing.previousKeys?.[version];
  if (previous) return previous;
  throw new Error("PROVIDER_CREDENTIAL_DECRYPT_FAILED");
}

export function desiredPayMongoContext(
  runtime: ProviderRuntimeEnvironment,
): ProviderContext {
  if (runtime.payMongoLivemode) {
    if (
      runtime.deploymentEnvironment !== "production" ||
      runtime.localProductionSimulation
    ) {
      throw new Error("PROVIDER_LIVE_MODE_FORBIDDEN");
    }
    return "LIVE";
  }
  return "TEST";
}

export function assertLiveProviderAllowed(
  runtime: ProviderRuntimeEnvironment,
  provider: ProviderName,
  environment: ProviderContext,
): void {
  if (
    provider === "PAYMONGO" &&
    environment === "LIVE" &&
    (runtime.deploymentEnvironment !== "production" ||
      runtime.localProductionSimulation)
  ) {
    throw new Error("PROVIDER_LIVE_MODE_FORBIDDEN");
  }
}

export function parseProviderSender(value: string): Readonly<{ name: string; email: string }> {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return match
    ? { name: match[1] || "BKE Digital Solutions", email: match[2]! }
    : { name: "BKE Digital Solutions", email: value };
}

export function assertProviderCredentialShape(
  provider: ProviderName,
  environment: ProviderContext,
  values: ReadonlyMap<ProviderCredentialKind, string>,
  senderEmail?: string | null,
  resendSenderDomain = "jl-bke.com",
): void {
  for (const kind of requiredProviderCredentials[provider]) {
    if (!values.get(kind)) throw new Error("PROVIDER_CREDENTIAL_MISSING");
  }

  if (provider === "PAYMONGO") {
    const secretKey = values.get("SECRET_KEY")!;
    if (
      environment === "TEST"
        ? !secretKey.startsWith("sk_test_")
        : !secretKey.startsWith("sk_live_")
    ) {
      throw new Error("PROVIDER_ENVIRONMENT_MISMATCH");
    }
    if (!values.get("WEBHOOK_SECRET")!.startsWith("whsk_")) {
      throw new Error("PROVIDER_CREDENTIAL_INVALID");
    }
    return;
  }

  if (!values.get("API_KEY")!.startsWith("re_")) {
    throw new Error("PROVIDER_CREDENTIAL_INVALID");
  }
  if (!senderEmail?.toLowerCase().endsWith(`@${resendSenderDomain.toLowerCase()}`)) {
    throw new Error("PROVIDER_CREDENTIAL_INVALID");
  }
}

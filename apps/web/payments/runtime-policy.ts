export function assertMockPaymentsAllowed(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const deploymentEnvironment = environment.DEPLOYMENT_ENV?.trim() || "development";
  if (deploymentEnvironment === "production") {
    throw new Error("V2_MOCK_PAYMENTS_FORBIDDEN_IN_PRODUCTION");
  }
}

/**
 * Real money is never allowed to use a disposable deployment or test key.
 * This guard checks configuration only: it does not call PayMongo.
 */
export function assertPayMongoModeAllowed(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const deployment = environment.DEPLOYMENT_ENV?.trim() || "development";
  const live = environment.PAYMONGO_LIVEMODE === "true";
  const key = environment.PAYMONGO_SECRET_KEY?.trim() || "";
  const webhook = environment.PAYMONGO_WEBHOOK_SECRET?.trim() || "";
  const providerSource = environment.PROVIDER_CONFIG_SOURCE?.trim() || "environment";

  if (deployment === "production" && !live) {
    throw new Error("PAYMONGO_PRODUCTION_REQUIRES_LIVEMODE");
  }
  if (live && (
    deployment !== "production" ||
    environment.PAYMENT_PROVIDER !== "paymongo" ||
    providerSource !== "environment" ||
    !/^sk_live_[A-Za-z0-9_-]{12,}$/.test(key) ||
    webhook.length < 16 ||
    webhook === key
  )) {
    throw new Error("PAYMONGO_LIVE_CONFIGURATION_INVALID");
  }
  if (!live && key.startsWith("sk_live_")) {
    throw new Error("PAYMONGO_LIVE_KEY_FORBIDDEN_OUTSIDE_LIVEMODE");
  }
}

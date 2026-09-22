export function assertMockPaymentsAllowed(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const deploymentEnvironment = environment.DEPLOYMENT_ENV?.trim() || "development";
  if (deploymentEnvironment === "production") {
    throw new Error("V2_MOCK_PAYMENTS_FORBIDDEN_IN_PRODUCTION");
  }
}

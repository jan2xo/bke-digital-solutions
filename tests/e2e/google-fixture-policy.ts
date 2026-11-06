type FixtureEnvironment = Readonly<Record<string, string | undefined>>;
function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1";
}
/** This is a guard for Node-owned disposable test fixtures, never an app login path. */
export function assertGoogleFixtureEnvironment(environment: FixtureEnvironment, appUrl: string): void {
  if (environment.NODE_ENV === "production" || !["test", "development", undefined].includes(environment.DEPLOYMENT_ENV)) {
    throw new Error("Google fixtures are forbidden for production deployments.");
  }
  if (environment.BKE_E2E_DISPOSABLE_DB !== "1") throw new Error("Disposable E2E database opt-in is required.");
  if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required for E2E fixtures.");
  const database = new URL(environment.DATABASE_URL);
  const app = new URL(appUrl);
  if (!["postgresql:", "postgres:"].includes(database.protocol) || !["http:", "https:"].includes(app.protocol)) {
    throw new Error("Unsupported Google fixture target.");
  }
  const local = isLoopback(database.hostname) && isLoopback(app.hostname);
  const disposableDocker = environment.NODE_ENV === "test" && environment.DEPLOYMENT_ENV === "test" &&
    environment.APP_URL === "https://caddy" && app.origin === "https://caddy" &&
    database.hostname === "postgres" && ["", "5432"].includes(database.port);
  if (!local && !disposableDocker) throw new Error("Google fixtures require a validated disposable local or certification Docker target.");
}

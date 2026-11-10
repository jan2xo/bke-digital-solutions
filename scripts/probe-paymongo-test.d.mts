/**
 * Static contract for the intentionally standalone Node 22 TEST-only probe.
 * The implementation remains a dependency-free .mjs executable for a protected
 * GitHub Actions runner, while the Vitest TS wrapper stays fully type-checked.
 */
export type TestModeEnvironment = Readonly<Record<string, string | undefined>>;

export type ProbeFetchOptions = Readonly<{
  method: "GET" | "POST";
  headers: Readonly<Record<string, string>>;
  body?: string;
  redirect?: "error";
  cache?: "no-store";
  signal?: AbortSignal;
}>;

export type ProbeFetcher = (
  url: string,
  options: ProbeFetchOptions,
) => Promise<Response>;

export interface ProbeOptions {
  environment?: TestModeEnvironment;
  fetchImpl?: ProbeFetcher;
  createCheckout?: boolean;
  nonce?: () => string;
}

export interface ProbeResult {
  status: "PASS";
  key: "AUTHENTICATED";
  checkout: "NOT_REQUESTED" | "TEST_SESSION_CREATED";
  webhook: "SECRET_PRESENT_NOT_PROVIDER_VERIFIED";
}

export function assertTestModeCredentials(
  environment?: TestModeEnvironment,
): Readonly<{ key: string; webhookSecret: string }>;

export function probePayMongoTest(options?: ProbeOptions): Promise<ProbeResult>;

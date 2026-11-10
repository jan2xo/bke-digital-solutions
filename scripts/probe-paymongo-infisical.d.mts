export type InfisicalProbeEnvironment = Readonly<Record<string, string | undefined>>;
export interface InfisicalProbeFetchOptions {
  method?: "GET" | "POST";
  headers?: Readonly<Record<string, string>>;
  body?: string;
  cache?: "no-store";
  redirect?: "error";
  signal?: AbortSignal;
}
export type InfisicalProbeFetch = (
  url: string,
  options: InfisicalProbeFetchOptions,
) => Promise<Response>;

export interface InfisicalProbeOptions {
  environment?: InfisicalProbeEnvironment;
  fetchImpl?: InfisicalProbeFetch;
  createCheckout?: boolean;
}
export interface ReadTestEnvironment {
  DEPLOYMENT_ENV: "test";
  PAYMENT_PROVIDER: "paymongo";
  PAYMONGO_LIVEMODE: "false";
  PAYMONGO_TEST_MODE_SECRET_KEY: string;
  PAYMONGO_TEST_MODE_WEBHOOK_SECRET: string;
}
export interface ProtectedProbeResult {
  status: "PASS";
  key: "AUTHENTICATED";
  checkout: "TEST_SESSION_CREATED" | "NOT_REQUESTED";
  webhook: "SECRET_PRESENT_NOT_PROVIDER_VERIFIED";
}
export function readNamedTestCredentials(options?: InfisicalProbeOptions): Promise<ReadTestEnvironment>;
export function runProtectedTestProbe(options?: InfisicalProbeOptions): Promise<ProtectedProbeResult>;

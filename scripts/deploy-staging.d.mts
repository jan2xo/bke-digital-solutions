export type StagingConfig = {
  name: string;
  hyperdrive: Array<{ binding: string; id: string; localConnectionString?: string }>;
  vars: Record<string, string>;
  observability?: { enabled?: boolean; redact_query_string?: boolean; logs?: { enabled?: boolean } };
  workers_dev?: boolean;
  triggers?: { crons?: string[] };
  [key: string]: unknown;
};
export type HyperdriveMetadata = {
  id: string;
  name: string;
  origin: { database: string; user: string; host: string; scheme: string; port: number };
  mtls?: { sslmode?: string };
  caching?: { disabled?: boolean };
};
export declare const expected: Readonly<Record<string, string>>;
export type WorkerScriptSettingsMetadata = {
  observability?: { enabled?: boolean; redact_query_string?: boolean; logs?: { enabled?: boolean } };
};
export declare function assertStagingSettings(env?: NodeJS.ProcessEnv): URL;
export declare function databaseUrl(name: string, value: string, expectedHost: string): URL;
export type RedisPingCode = "PONG" | "CONFIG_MISSING" | "INVALID_URL" | "TIMEOUT" | "NETWORK_ERROR" | "AUTH_UNAUTHORIZED" | "AUTH_FORBIDDEN" | "REDIRECT_BLOCKED" | "HTTP_ERROR" | "BODY_TOO_LARGE" | "INVALID_RESPONSE" | "BODY_READ_ERROR" | "PONG_MISMATCH";
export type RedisPingResult = { code: RedisPingCode; httpStatus: number | null; pong: boolean };
export declare function validateUpstashRestUrl(value: string): URL;
export declare function verifyUpstashRedis(env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): Promise<RedisPingResult>;
export declare function verifyObservabilityRedaction(settings: WorkerScriptSettingsMetadata): true;
export declare function buildStagingArtifacts(config: StagingConfig, env: NodeJS.ProcessEnv, driveId: string): { config: StagingConfig; secrets: Record<string, string>; direct: URL };
export declare function verifyHyperdriveMetadata(drive: HyperdriveMetadata, id: string, directUrl: URL, expectedHost: string): true;

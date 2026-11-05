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
export declare function verifyObservabilityRedaction(settings: WorkerScriptSettingsMetadata): true;
export declare function buildStagingArtifacts(config: StagingConfig, env: NodeJS.ProcessEnv, driveId: string): { config: StagingConfig; secrets: Record<string, string>; direct: URL };
export declare function verifyHyperdriveMetadata(drive: HyperdriveMetadata, id: string, directUrl: URL, expectedHost: string): true;

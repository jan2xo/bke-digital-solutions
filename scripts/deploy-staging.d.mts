export type StagingConfig = {
  name: string;
  hyperdrive: Array<{ binding: string; id: string; localConnectionString?: string }>;
  vars: Record<string, string>;
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
export declare function assertStagingSettings(env?: NodeJS.ProcessEnv): URL;
export declare function buildStagingArtifacts(config: StagingConfig, env: NodeJS.ProcessEnv, driveId: string): { config: StagingConfig; secrets: Record<string, string>; direct: URL };
export declare function verifyHyperdriveMetadata(drive: HyperdriveMetadata, id: string, directUrl: URL, expectedHost: string): true;

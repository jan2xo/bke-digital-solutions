export interface ReleaseWranglerConfig {
  name: string;
  main: string;
  assets: { directory: string; [key: string]: unknown };
  hyperdrive: Array<{ binding: string; id: string; localConnectionString?: string }>;
  services: Array<{ binding: string; service: string }>;
  send_email: Array<{ name: string }>;
  vars: Record<string, string>;
  workers_dev?: boolean;
  routes?: unknown;
  [key: string]: unknown;
}
export type ReleaseBinding = { name: string; type: string; [key: string]: unknown };
export type HyperdriveInfo = {
  id: string; name: string;
  origin: { database: string; host: string; user: string; port: number; scheme: string };
  caching: { disabled: boolean };
};
export declare const target: Readonly<{
  accountId: string; worker: string; domain: string; appUrl: string;
  deploymentId: string; hyperdriveId: string; hyperdriveName: string; database: string;
  databaseUser: string; neonHost: string;
}>;
export declare const generatedConfig: string;
export declare const snapshotFile: string;
export declare function buildProductionConfig(source: ReleaseWranglerConfig): ReleaseWranglerConfig;
export declare function bindingFingerprint(bindings: ReleaseBinding[]): string;
export declare function assertHyperdrive(drive: HyperdriveInfo): true;
export declare function inspectLive(): Promise<{ fingerprint: string; version: string }>;
export declare function prepare(): Promise<void>;
export declare function snapshot(): Promise<void>;
export declare function verify(): Promise<void>;
export declare function previousVersion(): Promise<void>;
export declare function cleanup(): Promise<void>;

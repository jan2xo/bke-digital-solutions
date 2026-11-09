export type ReleaseConfig = Readonly<Record<string, unknown>>;
export declare const target: Readonly<{
  accountId: string; worker: string; domain: string; appUrl: string;
  deploymentId: string; hyperdriveId: string; hyperdriveName: string; database: string;
}>;
export declare const generatedConfig: string;
export declare const snapshotFile: string;
export declare function buildProductionConfig(source: Record<string, any>): Record<string, any>;
export declare function bindingFingerprint(bindings: Array<Record<string, any>>): string;
export declare function assertHyperdrive(drive: Record<string, any>): true;
export declare function inspectLive(): Promise<{fingerprint: string; version: string}>;
export declare function prepare(): Promise<void>;
export declare function snapshot(): Promise<void>;
export declare function verify(): Promise<void>;
export declare function previousVersion(): Promise<void>;
export declare function cleanup(): Promise<void>;

export declare const expected: Readonly<Record<string, string>>;
export declare function assertStagingSettings(env?: NodeJS.ProcessEnv): URL;
export declare function buildStagingArtifacts(config: any, env: NodeJS.ProcessEnv, driveId: string): { config: any; secrets: Record<string,string>; direct: URL };
export declare function verifyHyperdriveMetadata(drive: any, id: string, directUrl: URL, expectedHost: string): true;
export declare function buildStagingArtifacts(config: any, env: NodeJS.ProcessEnv, driveId: string): { config: any; secrets: Record<string,string>; direct: URL };

export declare function assertOperatorContext(env: Record<string, string | undefined>): "verify_only" | "deploy";
export declare function assertLiveCloudflareSnapshot(snapshot: any): any;
export declare function assertRuntimeSecretBundle(raw: string, approvedRedisOrigin: string): Record<string, string>;
export declare function assertDeploymentApprovals(env: Record<string, string | undefined>, secretBundle: string): Record<string, string>;
export declare function readLiveCloudflare(token: string, requester?: any): Promise<any>;
export declare function prepareOperator(env?: Record<string, string | undefined>, requester?: any): Promise<string>;

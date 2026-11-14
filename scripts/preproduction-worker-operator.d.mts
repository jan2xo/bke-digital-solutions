import type { PreproductionTarget } from "./preproduction-staging-target.mjs";

export type LiveCloudflareSnapshot = {
  accounts: Array<{ id: string }>;
  drive: {
    id: string;
    name: string;
    origin: { host: string; port: number; database: string; scheme: string; user: string };
    caching: { disabled: boolean };
    mtls: { sslmode: string };
    origin_connection_limit: number;
  };
  workers: Array<{ id: string; name?: string }> | null;
};
export type CloudflareRequest = {
  headers: { Authorization: string; Accept: string };
  signal: AbortSignal;
};
export type CloudflareResponse = {
  ok: boolean;
  json?: () => Promise<{ success: boolean; result: unknown }>;
};
export type CloudflareRequester = (url: string, options: CloudflareRequest) => Promise<CloudflareResponse>;

export declare function assertOperatorContext(env: Record<string, string | undefined>): "verify_only" | "deploy";
export declare function assertLiveCloudflareSnapshot(snapshot: LiveCloudflareSnapshot): PreproductionTarget;
export declare function assertRuntimeSecretBundle(raw: string, approvedRedisOrigin: string): Record<string, string>;
export declare function assertDeploymentApprovals(env: Record<string, string | undefined>, secretBundle: string): Record<string, string>;
export declare function readLiveCloudflare(token: string, requester?: CloudflareRequester): Promise<PreproductionTarget>;
export declare function prepareOperator(env?: Record<string, string | undefined>, requester?: CloudflareRequester): Promise<string>;

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
  workers: Array<{ id: string; name?: string; tag?: string; routes?: unknown[] }> | null;
};
export type CloudflareRequest = {
  method?: "POST" | "GET";
  headers: { Authorization: string; Accept: string; "Content-Type"?: string };
  body?: string;
  signal: AbortSignal;
};
export type CloudflareResponse = {
  ok: boolean;
  json?: () => Promise<{ success: boolean; result: unknown }>;
};
export type CloudflareRequester = (url: string, options: CloudflareRequest) => Promise<CloudflareResponse>;

export declare function assertOperatorContext(env: Record<string, string | undefined>): "verify_only" | "deploy" | "activate_access_route";
export type ObservedPreproductionTarget = PreproductionTarget & { workerTag: string | null };
export declare function assertLiveCloudflareSnapshot(snapshot: LiveCloudflareSnapshot, mode?: "verify_only" | "deploy" | "activate_access_route"): ObservedPreproductionTarget;
export declare function assertProtectedRouteReadiness(snapshot: unknown, candidate: unknown, operatorEmail: string): true;
export declare function assertRuntimeSecretBundle(raw: string, approvedRedisOrigin: string): Record<string, string>;
export declare function assertDeploymentApprovals(env: Record<string, string | undefined>, secretBundle: string): Record<string, string>;
export declare function readLiveCloudflare(token: string, requester?: CloudflareRequester, mode?: "verify_only" | "deploy" | "activate_access_route", sourceSha?: string | null, operatorEmail?: string | null): Promise<ObservedPreproductionTarget>;
export declare function prepareOperator(env?: Record<string, string | undefined>, requester?: CloudflareRequester): Promise<string>;

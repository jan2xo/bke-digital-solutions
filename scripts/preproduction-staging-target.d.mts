export type PreproductionTarget = {
  worker: string;
  origin: string;
  cloudflareAccountId: string;
  neonProjectId: string;
  neonBranchId: string;
  neonParentBranchId: string | null;
  database: string;
  databaseRole: string;
  neonDirectHost: string;
  hyperdriveId: string;
  hyperdriveOriginDatabase: string;
  hyperdriveOriginRole: string;
  hyperdriveOriginHost: string;
  hyperdriveCachingDisabled: boolean;
  hyperdriveTlsMode: string;
  redisPrefix: string;
};
export type PreproductionWorkerCandidate = {
  name: string;
  workers_dev: boolean;
  preview_urls: boolean;
  services: Array<{ binding: string; service: string }>;
  hyperdrive: Array<{ binding: string; id: string }>;
  vars: Record<string, string>;
  observability: Record<string, unknown>;
  [key: string]: unknown;
};
export declare const proposed: Readonly<{
  worker: string; origin: string; cloudflareAccountId: string;
  neonProjectId: string; neonBranchId: string; neonDirectHost: string;
  hyperdriveId: string; database: string; databaseRole: string; namespace: string;
}>;
export declare function assertIndependentPreproductionIdentity(target: PreproductionTarget): true;
export declare function buildPreproductionWorkerCandidate(source: Record<string, unknown>, target: PreproductionTarget, sourceSha: string): PreproductionWorkerCandidate;

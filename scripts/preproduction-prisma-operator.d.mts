export type OperatorEnv = Record<string, string | undefined>;
export type SqlIdentity = {
  database?: string;
  db_role?: string;
  public_tables?: number | string;
  prisma_ledger?: string | null;
  mock_schemas?: number | string;
  unapproved_schemas?: number | string;
};
export type MigrationLedgerRow = {
  migration_name: string;
  checksum: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
};
export declare const pinned: Readonly<{
  repository: string; actor: string; orgId: string;
  projectId: string; projectName: string; branchId: string; branchName: string;
  computeHost: string; database: string; role: string; region: string; pgVersion: number;
}>;
export declare function validateOperatorContext(env: OperatorEnv, mode: "preflight" | "verify"):
  Readonly<{ url: URL; mode: string; sourceSha: string }>;
export declare function readSourceMigrations(directory?: string): Map<string, string>;
export declare function verifyMigrationLedger(source: Map<string, string>, rows: MigrationLedgerRow[]):
  { officialMigrations: number; checksumVerified: boolean };
export declare function verifySqlIdentity(row: SqlIdentity, mode: "preflight" | "verify"): true;
export declare function runOperator(mode: "preflight" | "verify", env?: OperatorEnv):
  Promise<{ cleanRoot: true } | { officialMigrations: number; checksumVerified: boolean }>;

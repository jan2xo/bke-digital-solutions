import "server-only";

export interface BackupEnvironment {
  readonly enabled: boolean;
  readonly deploymentId: string;
  readonly retentionDaily: number;
  readonly retentionWeekly: number;
  readonly retentionMonthly: number;
  readonly restoreAck?: string;
  readonly restoreDatabaseUrl?: string;
  readonly restoreS3Bucket?: string;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

function bool(name: string, fallback: boolean): boolean {
  const value = optional(name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid backup environment: ${name}`);
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid backup environment: ${name}`);
  return value;
}

export function getBackupEnvironment(): BackupEnvironment {
  const deploymentId = optional("DEPLOYMENT_ID") ?? "bke-development";
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(deploymentId)) throw new Error("Invalid backup environment: DEPLOYMENT_ID");
  const restoreS3Bucket = optional("BACKUP_RESTORE_S3_BUCKET");
  if (restoreS3Bucket !== undefined && restoreS3Bucket.length < 3) throw new Error("Invalid backup environment: BACKUP_RESTORE_S3_BUCKET");
  return Object.freeze({
    enabled: bool("BACKUP_ENABLED", false),
    deploymentId,
    retentionDaily: integer("BACKUP_RETENTION_DAILY", 7, 1, 365),
    retentionWeekly: integer("BACKUP_RETENTION_WEEKLY", 4, 1, 104),
    retentionMonthly: integer("BACKUP_RETENTION_MONTHLY", 12, 1, 120),
    restoreAck: optional("BACKUP_RESTORE_ACK"),
    restoreDatabaseUrl: optional("BACKUP_RESTORE_DATABASE_URL"),
    restoreS3Bucket,
  });
}

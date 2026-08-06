import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requestBackup, requestBackupOperation } from "@/lib/backups/service";
import { retentionTier } from "@/lib/backups/policy";
import type { JobContext, JobSummary } from "@/lib/scheduler/types";

export async function backupCreation(context: JobContext): Promise<JobSummary> {
  const day = context.now.toISOString().slice(0, 10);
  if (context.dryRun) return { wouldQueue: env.BACKUP_ENABLED, retentionTier: retentionTier(context.now), window: day };
  if (!env.BACKUP_ENABLED) return { skipped: true, reason: "BACKUPS_DISABLED" };
  const operation = await requestBackup({ trigger: "SCHEDULED", tier: retentionTier(context.now), now: context.now, idempotencyKey: `backup:scheduled:${env.DEPLOYMENT_ID}:${day}` });
  return { queued: true, backupId: operation.backupId, operationId: operation.id };
}

export async function backupRetention(context: JobContext): Promise<JobSummary> {
  const expired = await db.backupArchive.findMany({ where: { expiresAt: { lte: context.now }, status: { in: ["AVAILABLE", "VERIFIED", "INCOMPLETE", "FAILED"] } }, select: { id: true } });
  if (context.dryRun) return { wouldExpire: expired.length };
  for (const backup of expired) {
    await db.backupArchive.update({ where: { id: backup.id }, data: { status: "EXPIRED" } });
    await requestBackupOperation({ backupId: backup.id, type: "DELETE_EXPIRED", dryRun: false });
  }
  return { expired: expired.length, deletionQueued: expired.length };
}

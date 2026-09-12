import "server-only";

import type { JobContext, JobSummary } from "@/v2/platform/scheduler";
import { retentionTier } from "@/v2/platform/backups/policy";
import { db } from "@/v2/platform/host/db";
import { getBackupEnvironment } from "@/v2/apps/web/backups/config";
import { requestBackup, requestBackupOperation } from "@/v2/apps/web/backups/service";

export async function backupCreation(context: JobContext): Promise<JobSummary> {
  const environment = getBackupEnvironment();
  const day = context.now.toISOString().slice(0, 10);
  if (context.dryRun) {
    return {
      wouldQueue: environment.enabled,
      retentionTier: retentionTier(context.now),
      window: day,
    };
  }
  if (!environment.enabled) return { skipped: true, reason: "BACKUPS_DISABLED" };
  const operation = await requestBackup({
    trigger: "SCHEDULED",
    tier: retentionTier(context.now),
    now: context.now,
    idempotencyKey: `backup:scheduled:${environment.deploymentId}:${day}`,
  });
  return { queued: true, backupId: operation.backupId, operationId: operation.id };
}

export async function backupRetention(context: JobContext): Promise<JobSummary> {
  const expired = await db.backupArchive.findMany({
    where: {
      expiresAt: { lte: context.now },
      status: { in: ["AVAILABLE", "VERIFIED", "INCOMPLETE", "FAILED"] },
    },
    select: { id: true },
  });
  if (context.dryRun) return { wouldExpire: expired.length };
  for (const backup of expired) {
    await db.backupArchive.update({ where: { id: backup.id }, data: { status: "EXPIRED" } });
    await requestBackupOperation({ backupId: backup.id, type: "DELETE_EXPIRED", dryRun: false });
  }
  return { expired: expired.length, deletionQueued: expired.length };
}

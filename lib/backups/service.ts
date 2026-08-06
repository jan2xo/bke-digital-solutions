import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { expiresAt, retentionTier, retryAt, validateRestoreConfirmation } from "@/lib/backups/policy";
import { Prisma, type BackupOperationTrigger, type BackupOperationType, type BackupRetentionTier } from "@/generated/prisma/client";

const retentionPolicy = { daily: env.BACKUP_RETENTION_DAILY, weekly: env.BACKUP_RETENTION_WEEKLY, monthly: env.BACKUP_RETENTION_MONTHLY };

export async function requestBackup(input: { actorId?: string; trigger: BackupOperationTrigger; dryRun?: boolean; tier?: BackupRetentionTier; idempotencyKey?: string; now?: Date }) {
  if (!input.dryRun && !env.BACKUP_ENABLED) throw new Error("BACKUPS_DISABLED");
  const now = input.now ?? new Date();
  const tier = input.tier ?? (input.trigger === "SCHEDULED" ? retentionTier(now) : "MANUAL");
  const idempotencyKey = input.idempotencyKey ?? `backup:create:${randomUUID()}`;
  const existing = await db.backupOperation.findUnique({ where: { idempotencyKey }, include: { backup: true } });
  if (existing) return existing;
  const backupId = `bkp_${randomUUID().replaceAll("-", "")}`;
  let result;
  try {
    result = await db.$transaction(async (transaction) => {
    const backup = await transaction.backupArchive.create({ data: {
      id: backupId,
      retentionTier: tier,
      deploymentId: env.DEPLOYMENT_ID,
      storagePrefix: `${env.DEPLOYMENT_ID}/${backupId}`,
      expiresAt: expiresAt(tier, now, retentionPolicy),
    } });
    const operation = await transaction.backupOperation.create({ data: {
      backupId: backup.id,
      type: "CREATE",
      trigger: input.trigger,
      requestedById: input.actorId,
      dryRun: input.dryRun ?? false,
      correlationId: randomUUID(),
      idempotencyKey,
    } });
    return { ...operation, backup };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await db.backupOperation.findUnique({ where: { idempotencyKey }, include: { backup: true } });
      if (duplicate) return duplicate;
    }
    throw error;
  }
  await audit({ actorId: input.actorId, action: "BACKUP_CREATE_REQUESTED", targetType: "BackupArchive", targetId: result.backup.id, metadata: { trigger: input.trigger, dryRun: input.dryRun ?? false, retentionTier: tier } });
  return result;
}

export async function requestBackupOperation(input: { backupId: string; type: Exclude<BackupOperationType, "CREATE">; actorId?: string; confirmation?: string; dryRun?: boolean }) {
  const backup = await db.backupArchive.findUnique({ where: { id: input.backupId } });
  if (!backup) throw new Error("BACKUP_NOT_FOUND");
  if (input.type === "RESTORE_ISOLATED") {
    if (!validateRestoreConfirmation(backup.id, input.confirmation ?? "")) throw new Error("INVALID_RESTORE_CONFIRMATION");
    if (env.BACKUP_RESTORE_ACK !== "ISOLATED_TARGET_ONLY" || !env.BACKUP_RESTORE_DATABASE_URL || !env.BACKUP_RESTORE_S3_BUCKET) throw new Error("ISOLATED_RESTORE_NOT_CONFIGURED");
  }
  const operation = await db.backupOperation.create({ data: {
    backupId: backup.id,
    type: input.type,
    trigger: "MANUAL",
    requestedById: input.actorId,
    dryRun: input.dryRun ?? false,
    correlationId: randomUUID(),
    idempotencyKey: `backup:${input.type.toLowerCase()}:${backup.id}:${randomUUID()}`,
  } });
  await audit({ actorId: input.actorId, action: `BACKUP_${input.type}_REQUESTED`, targetType: "BackupArchive", targetId: backup.id, metadata: { operationId: operation.id, dryRun: operation.dryRun } });
  return operation;
}

export async function recoverAbandonedBackupOperations(now = new Date()) {
  const abandonedBefore = new Date(now.getTime() - 60 * 60_000);
  const abandoned = await db.backupOperation.findMany({ where: { status: "PROCESSING", startedAt: { lt: abandonedBefore } }, select: { id: true, attempts: true, maxAttempts: true } });
  for (const operation of abandoned) {
    const terminal = operation.attempts >= operation.maxAttempts;
    await db.backupOperation.update({ where: { id: operation.id }, data: { status: terminal ? "FAILED" : "RETRYING", nextAttemptAt: terminal ? now : retryAt(operation.attempts, now), claimedBy: null, errorCode: "ABANDONED_OPERATION" } });
  }
  return abandoned.length;
}

export async function claimBackupOperation(workerId: string, now = new Date()) {
  return db.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "BackupOperation"
      WHERE "status" IN ('PENDING', 'RETRYING') AND "nextAttemptAt" <= ${now}
      ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
    `;
    if (!rows[0]) return null;
    return transaction.backupOperation.update({ where: { id: rows[0].id }, data: { status: "PROCESSING", claimedBy: workerId, startedAt: now, attempts: { increment: 1 }, errorCode: null }, include: { backup: true } });
  });
}

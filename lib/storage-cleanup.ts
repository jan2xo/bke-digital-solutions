import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { StorageCleanupJobType } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { deleteObject } from "@/lib/storage";

const MAX_ATTEMPTS = 5;
const PROCESSING_TIMEOUT_MS = 15 * 60_000;
const errorCode = (error: unknown) => createHash("sha256").update(error instanceof Error ? error.name : "unknown").digest("hex").slice(0, 16);
const backoff = (attempts: number) => new Date(Date.now() + Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1)));
export const storageCleanupIdempotencyKey = (type: StorageCleanupJobType, targetId: string, objectKey: string) =>
  createHash("sha256").update(`${type}:${targetId}:${objectKey}`).digest("hex");

export async function queueStorageCleanup(input: {
  type: StorageCleanupJobType; targetType: string; targetId: string; objectKey: string;
  productId?: string; artifactId?: string; actorId?: string; correlationId?: string;
}) {
  const idempotencyKey = storageCleanupIdempotencyKey(input.type, input.targetId, input.objectKey);
  try {
    return await db.storageCleanupJob.upsert({
      where: { idempotencyKey }, update: {},
      create: { type: input.type, targetType: input.targetType, targetId: input.targetId, objectKey: input.objectKey, productId: input.productId, artifactId: input.artifactId, createdByAdminId: input.actorId, correlationId: input.correlationId ?? randomUUID(), idempotencyKey },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return db.storageCleanupJob.findUniqueOrThrow({ where: { idempotencyKey } });
    throw error;
  }
}

export async function recoverAbandonedCleanupJobs() {
  return db.storageCleanupJob.updateMany({
    where: { status: "PROCESSING", startedAt: { lt: new Date(Date.now() - PROCESSING_TIMEOUT_MS) } },
    data: { status: "RETRYING", nextAttemptAt: new Date(), lastErrorCode: "PROCESSING_TIMEOUT" },
  });
}

export async function retryStorageCleanupJob(id: string, actorId: string) {
  const job = await db.storageCleanupJob.findUnique({ where: { id } });
  if (!job) throw new Error("NOT_FOUND");
  if (!["FAILED", "RETRYING"].includes(job.status)) throw new Error("INVALID_STATE");
  await db.$transaction([
    db.storageCleanupJob.update({ where: { id }, data: { status: "RETRYING", nextAttemptAt: new Date(), lastErrorCode: null } }),
    db.auditLog.create({ data: { actorId, action: "STORAGE_CLEANUP_RETRY_REQUESTED", targetType: job.targetType, targetId: job.targetId, metadata: { cleanupJobId: id, attempts: job.attempts } } }),
  ]);
}

export async function processStorageCleanupJob(id: string, removeObject: (objectKey: string) => Promise<void> = deleteObject) {
  const claimed = await db.storageCleanupJob.updateMany({
    where: { id, status: { in: ["PENDING", "RETRYING"] }, nextAttemptAt: { lte: new Date() } },
    data: { status: "PROCESSING", startedAt: new Date(), attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return { claimed: false as const };
  const job = await db.storageCleanupJob.findUniqueOrThrow({ where: { id } });
  try {
    if (["ARTIFACT_REPLACEMENT", "ARTIFACT_REMOVAL"].includes(job.type)) {
      const activeReference = await db.productArtifact.findFirst({ where: { objectKey: job.objectKey, active: true, removedAt: null } });
      if (activeReference) throw new Error("ACTIVE_ARTIFACT_REFERENCE");
    }
    await removeObject(job.objectKey);
    await db.$transaction([
      db.storageCleanupJob.update({ where: { id }, data: { status: "SUCCEEDED", completedAt: new Date(), lastErrorCode: null } }),
      db.auditLog.create({ data: { actorId: job.createdByAdminId, action: "STORAGE_CLEANUP_COMPLETED", targetType: job.targetType, targetId: job.targetId, metadata: { cleanupJobId: job.id, attempts: job.attempts } } }),
    ]);
    return { claimed: true as const, succeeded: true as const };
  } catch (error) {
    const failed = job.attempts >= MAX_ATTEMPTS;
    await db.$transaction([
      db.storageCleanupJob.update({ where: { id }, data: { status: failed ? "FAILED" : "RETRYING", nextAttemptAt: backoff(job.attempts), lastErrorCode: errorCode(error) } }),
      db.auditLog.create({ data: { actorId: job.createdByAdminId, action: failed ? "STORAGE_CLEANUP_FAILED" : "STORAGE_CLEANUP_RETRY_SCHEDULED", targetType: job.targetType, targetId: job.targetId, metadata: { cleanupJobId: job.id, attempts: job.attempts } } }),
      ...(failed ? [db.securityEvent.create({ data: { userId: job.createdByAdminId, type: "STORAGE_CLEANUP_FAILED", outcome: "FAILURE", severity: "HIGH", metadata: { count: job.attempts } } })] : []),
    ]);
    return { claimed: true as const, succeeded: false as const, failed };
  }
}

export async function processReadyStorageCleanupJobs(limit = 20, removeObject: (objectKey: string) => Promise<void> = deleteObject) {
  await recoverAbandonedCleanupJobs();
  const jobs = await db.storageCleanupJob.findMany({ where: { status: { in: ["PENDING", "RETRYING"] }, nextAttemptAt: { lte: new Date() } }, select: { id: true }, orderBy: { createdAt: "asc" }, take: Math.min(limit, 100) });
  const results = [];
  for (const job of jobs) results.push(await processStorageCleanupJob(job.id, removeObject));
  return results;
}

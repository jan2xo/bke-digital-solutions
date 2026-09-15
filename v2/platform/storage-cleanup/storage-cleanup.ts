import { randomUUID } from "node:crypto";
import type {
  QueueStorageCleanupInput,
  StorageCleanupEligibilityGuard,
  StorageCleanupOperationalEvent,
  StorageCleanupOperationalEventSink,
  StorageCleanupStore,
  StorageObjectDeleter,
} from "./contracts";
import {
  boundedStorageCleanupBatchSize,
  STORAGE_CLEANUP_MAX_ATTEMPTS,
  STORAGE_CLEANUP_PROCESSING_TIMEOUT_MS,
  storageCleanupBackoffAt,
  storageCleanupErrorCode,
  storageCleanupIdempotencyKey,
} from "./policy";

export type StorageCleanupPlatform = Readonly<{
  queue(input: QueueStorageCleanupInput): Promise<Awaited<ReturnType<StorageCleanupStore["upsertQueued"]>>>;
  recoverAbandoned(now?: Date): Promise<number>;
  retry(id: string, actorId: string, now?: Date): Promise<void>;
  process(id: string, now?: Date): Promise<
    | Readonly<{ claimed: false }>
    | Readonly<{ claimed: true; succeeded: true }>
    | Readonly<{ claimed: true; succeeded: false; failed: boolean; errorCode: string }>
  >;
  processReady(limit?: number, now?: Date): Promise<readonly unknown[]>;
}>;

export function createStorageCleanupPlatform(dependencies: Readonly<{
  store: StorageCleanupStore;
  eligibility: StorageCleanupEligibilityGuard;
  objects: StorageObjectDeleter;
  events?: StorageCleanupOperationalEventSink;
  now?: () => Date;
  correlationId?: () => string;
}>): StorageCleanupPlatform {
  const clock = dependencies.now ?? (() => new Date());
  const correlationId = dependencies.correlationId ?? randomUUID;

  async function emit(event: StorageCleanupOperationalEvent): Promise<void> {
    await dependencies.events?.emit(event);
  }

  async function queue(input: QueueStorageCleanupInput) {
    const now = clock();
    return dependencies.store.upsertQueued({
      job: {
        type: input.type,
        targetType: input.targetType,
        targetId: input.targetId,
        objectKey: input.objectKey,
        productId: input.productId,
        artifactId: input.artifactId,
        createdByActorId: input.actorId,
        correlationId: input.correlationId ?? correlationId(),
        idempotencyKey: storageCleanupIdempotencyKey(
          input.type,
          input.targetId,
          input.objectKey,
        ),
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: now,
        startedAt: null,
        completedAt: null,
        lastErrorCode: null,
      },
    });
  }

  async function recoverAbandoned(now = clock()): Promise<number> {
    return dependencies.store.recoverAbandoned({
      startedBefore: new Date(now.getTime() - STORAGE_CLEANUP_PROCESSING_TIMEOUT_MS),
      retryAt: now,
      errorCode: "PROCESSING_TIMEOUT",
    });
  }

  async function retry(id: string, actorId: string, now = clock()): Promise<void> {
    const job = await dependencies.store.get(id);
    if (!job) throw new Error("NOT_FOUND");
    if (job.status !== "FAILED" && job.status !== "RETRYING") {
      throw new Error("INVALID_STATE");
    }
    await dependencies.store.requestRetry({ id, retryAt: now });
    await emit({
      action: "STORAGE_CLEANUP_RETRY_REQUESTED",
      jobId: job.id,
      targetType: job.targetType,
      targetId: job.targetId,
      actorId,
      attempts: job.attempts,
    });
  }

  async function process(id: string, now = clock()) {
    const claimed = await dependencies.store.claim({ id, now });
    if (!claimed) return { claimed: false as const };

    const job = await dependencies.store.get(id);
    if (!job) throw new Error("CLEANUP_JOB_DISAPPEARED_AFTER_CLAIM");

    try {
      const eligibility = await dependencies.eligibility.canDelete(job);
      if (!eligibility.allowed) {
        throw new Error(eligibility.code ?? "OBJECT_DELETE_BLOCKED");
      }

      await dependencies.objects.deleteObject(job.objectKey);
      const completedAt = clock();
      await dependencies.store.markSucceeded({ id: job.id, completedAt });
      await emit({
        action: "STORAGE_CLEANUP_COMPLETED",
        jobId: job.id,
        targetType: job.targetType,
        targetId: job.targetId,
        actorId: job.createdByActorId,
        attempts: job.attempts,
      });
      return { claimed: true as const, succeeded: true as const };
    } catch (error) {
      const errorCode = storageCleanupErrorCode(error);
      const failed = job.attempts >= STORAGE_CLEANUP_MAX_ATTEMPTS;
      if (failed) {
        await dependencies.store.markFailed({
          id: job.id,
          completedAt: clock(),
          lastErrorCode: errorCode,
        });
      } else {
        await dependencies.store.markRetrying({
          id: job.id,
          nextAttemptAt: storageCleanupBackoffAt(job.attempts, clock()),
          lastErrorCode: errorCode,
        });
      }
      await emit({
        action: failed
          ? "STORAGE_CLEANUP_FAILED"
          : "STORAGE_CLEANUP_RETRY_SCHEDULED",
        jobId: job.id,
        targetType: job.targetType,
        targetId: job.targetId,
        actorId: job.createdByActorId,
        attempts: job.attempts,
        errorCode,
        terminal: failed,
      });
      return {
        claimed: true as const,
        succeeded: false as const,
        failed,
        errorCode,
      };
    }
  }

  async function processReady(limit = 20, now = clock()): Promise<readonly unknown[]> {
    await recoverAbandoned(now);
    const ids = await dependencies.store.listReady({
      now,
      limit: boundedStorageCleanupBatchSize(limit),
    });
    const results: unknown[] = [];
    for (const id of ids) results.push(await process(id, now));
    return results;
  }

  return Object.freeze({ queue, recoverAbandoned, retry, process, processReady });
}

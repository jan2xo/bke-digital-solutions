import "server-only";

import { randomUUID } from "node:crypto";
import {
  createStorageCleanupPlatform,
  storageCleanupIdempotencyKey,
  type QueueStorageCleanupInput,
  type StorageCleanupJob,
  type StorageCleanupStatus,
  type StorageCleanupStore,
} from "@/v2/platform/storage-cleanup";
import { audit } from "@/v2/apps/web/audit";
import { getPostgresPool } from "@/v2/apps/web/persistence/postgres";
import { deleteObject } from "@/v2/apps/web/storage/object-storage";

export { storageCleanupIdempotencyKey };

type StorageCleanupRow = {
  id: string;
  type: string;
  status: StorageCleanupStatus;
  targetType: string;
  targetId: string;
  objectKey: string;
  idempotencyKey: string;
  attempts: number;
  nextAttemptAt: Date;
  lastErrorCode: string | null;
  correlationId: string;
  productId: string | null;
  artifactId: string | null;
  createdByAdminId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
};

const projection = `
  "id", "type"::text AS "type", "status"::text AS "status", "targetType", "targetId",
  "objectKey", "idempotencyKey", "attempts", "nextAttemptAt", "lastErrorCode", "correlationId",
  "productId", "artifactId", "createdByAdminId", "startedAt", "completedAt"`;

function job(row: StorageCleanupRow): StorageCleanupJob {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    targetType: row.targetType,
    targetId: row.targetId,
    objectKey: row.objectKey,
    idempotencyKey: row.idempotencyKey,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    lastErrorCode: row.lastErrorCode,
    correlationId: row.correlationId,
    productId: row.productId,
    artifactId: row.artifactId,
    createdByActorId: row.createdByAdminId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

const store: StorageCleanupStore = {
  async upsertQueued({ job: input }) {
    const id = randomUUID();
    const inserted = await getPostgresPool().query<StorageCleanupRow>(
      `INSERT INTO "StorageCleanupJob"
         ("id", "type", "status", "targetType", "targetId", "objectKey", "idempotencyKey", "attempts",
          "nextAttemptAt", "lastErrorCode", "correlationId", "productId", "artifactId", "createdByAdminId")
       VALUES ($1, $2::"StorageCleanupJobType", 'PENDING'::"StorageCleanupStatus", $3, $4, $5, $6, 0,
               $7, NULL, $8, $9, $10, $11)
       ON CONFLICT ("idempotencyKey") DO NOTHING
       RETURNING ${projection}`,
      [
        id,
        input.type,
        input.targetType,
        input.targetId,
        input.objectKey,
        input.idempotencyKey,
        input.nextAttemptAt,
        input.correlationId,
        input.productId ?? null,
        input.artifactId ?? null,
        input.createdByActorId ?? null,
      ],
    );
    if (inserted.rows[0]) return job(inserted.rows[0]);
    const existing = await getPostgresPool().query<StorageCleanupRow>(
      `SELECT ${projection} FROM "StorageCleanupJob" WHERE "idempotencyKey" = $1 LIMIT 1`,
      [input.idempotencyKey],
    );
    if (!existing.rows[0]) throw new Error("STORAGE_CLEANUP_UPSERT_FAILED");
    return job(existing.rows[0]);
  },

  async get(id) {
    const result = await getPostgresPool().query<StorageCleanupRow>(
      `SELECT ${projection} FROM "StorageCleanupJob" WHERE "id" = $1 LIMIT 1`,
      [id],
    );
    return result.rows[0] ? job(result.rows[0]) : null;
  },

  async claim({ id, now }) {
    const result = await getPostgresPool().query(
      `UPDATE "StorageCleanupJob"
          SET "status" = 'PROCESSING'::"StorageCleanupStatus", "startedAt" = $2, "attempts" = "attempts" + 1
        WHERE "id" = $1
          AND "status" IN ('PENDING'::"StorageCleanupStatus", 'RETRYING'::"StorageCleanupStatus")
          AND "nextAttemptAt" <= $2
       RETURNING "id"`,
      [id, now],
    );
    return result.rowCount === 1;
  },

  async recoverAbandoned({ startedBefore, retryAt, errorCode }) {
    const result = await getPostgresPool().query(
      `UPDATE "StorageCleanupJob"
          SET "status" = 'RETRYING'::"StorageCleanupStatus", "nextAttemptAt" = $2, "lastErrorCode" = $3
        WHERE "status" = 'PROCESSING'::"StorageCleanupStatus" AND "startedAt" < $1`,
      [startedBefore, retryAt, errorCode],
    );
    return result.rowCount ?? 0;
  },

  async requestRetry({ id, retryAt }) {
    await getPostgresPool().query(
      `UPDATE "StorageCleanupJob"
          SET "status" = 'RETRYING'::"StorageCleanupStatus", "nextAttemptAt" = $2, "lastErrorCode" = NULL
        WHERE "id" = $1`,
      [id, retryAt],
    );
  },

  async markSucceeded({ id, completedAt }) {
    await getPostgresPool().query(
      `UPDATE "StorageCleanupJob"
          SET "status" = 'SUCCEEDED'::"StorageCleanupStatus", "completedAt" = $2, "lastErrorCode" = NULL
        WHERE "id" = $1`,
      [id, completedAt],
    );
  },

  async markRetrying({ id, nextAttemptAt, lastErrorCode }) {
    await getPostgresPool().query(
      `UPDATE "StorageCleanupJob"
          SET "status" = 'RETRYING'::"StorageCleanupStatus", "nextAttemptAt" = $2, "lastErrorCode" = $3
        WHERE "id" = $1`,
      [id, nextAttemptAt, lastErrorCode],
    );
  },

  async markFailed({ id, completedAt, lastErrorCode }) {
    await getPostgresPool().query(
      `UPDATE "StorageCleanupJob"
          SET "status" = 'FAILED'::"StorageCleanupStatus", "completedAt" = $2, "lastErrorCode" = $3
        WHERE "id" = $1`,
      [id, completedAt, lastErrorCode],
    );
  },

  async listReady({ now, limit }) {
    const result = await getPostgresPool().query<{ id: string }>(
      `SELECT "id" FROM "StorageCleanupJob"
        WHERE "status" IN ('PENDING'::"StorageCleanupStatus", 'RETRYING'::"StorageCleanupStatus")
          AND "nextAttemptAt" <= $1
        ORDER BY "createdAt" ASC
        LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => row.id);
  },
};

function createPlatform(removeObject: (objectKey: string) => Promise<void>) {
  return createStorageCleanupPlatform({
    store,
    eligibility: {
      async canDelete(candidate) {
        if (candidate.type !== "ARTIFACT_REPLACEMENT" && candidate.type !== "ARTIFACT_REMOVAL") {
          return { allowed: true };
        }
        const active = await getPostgresPool().query(
          `SELECT 1 FROM "ProductArtifact"
            WHERE "objectKey" = $1 AND "active" = true AND "removedAt" IS NULL
            LIMIT 1`,
          [candidate.objectKey],
        );
        return active.rowCount ? { allowed: false, code: "ACTIVE_ARTIFACT_REFERENCE" } : { allowed: true };
      },
    },
    objects: { deleteObject: removeObject },
    events: {
      async emit(event) {
        await audit({
          actorId: event.actorId ?? undefined,
          action: event.action,
          targetType: event.targetType,
          targetId: event.targetId,
          metadata: { cleanupJobId: event.jobId, attempts: event.attempts },
        });
        if (event.action === "STORAGE_CLEANUP_FAILED") {
          await getPostgresPool().query(
            `INSERT INTO "SecurityEvent"
               ("id", "userId", "type", "outcome", "severity", "metadata", "createdAt")
             VALUES ($1, $2, 'STORAGE_CLEANUP_FAILED'::"SecurityEventType", 'FAILURE'::"SecurityEventOutcome",
                     'HIGH'::"SecurityEventSeverity", $3::jsonb, NOW())`,
            [randomUUID(), event.actorId ?? null, JSON.stringify({ count: event.attempts })],
          );
        }
      },
    },
  });
}

const platform = createPlatform(deleteObject);

export function queueStorageCleanup(input: QueueStorageCleanupInput) {
  return platform.queue(input);
}

export function recoverAbandonedCleanupJobs() {
  return platform.recoverAbandoned();
}

export function retryStorageCleanupJob(id: string, actorId: string) {
  return platform.retry(id, actorId);
}

export function processStorageCleanupJob(id: string, removeObject: (objectKey: string) => Promise<void> = deleteObject) {
  return removeObject === deleteObject ? platform.process(id) : createPlatform(removeObject).process(id);
}

export function processReadyStorageCleanupJobs(limit = 20) {
  return platform.processReady(limit);
}

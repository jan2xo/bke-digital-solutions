import { createHash } from "node:crypto";

export const STORAGE_CLEANUP_MAX_ATTEMPTS = 5;
export const STORAGE_CLEANUP_PROCESSING_TIMEOUT_MS = 15 * 60_000;
export const STORAGE_CLEANUP_DEFAULT_BATCH_SIZE = 20;
export const STORAGE_CLEANUP_MAX_BATCH_SIZE = 100;

export function storageCleanupIdempotencyKey(
  type: string,
  targetId: string,
  objectKey: string,
): string {
  return createHash("sha256")
    .update(`${type}:${targetId}:${objectKey}`)
    .digest("hex");
}

export function storageCleanupErrorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : "unknown";
  return createHash("sha256").update(name).digest("hex").slice(0, 16);
}

export function storageCleanupBackoffAt(attempts: number, now = new Date()): Date {
  const delay = Math.min(
    60 * 60_000,
    30_000 * 2 ** Math.max(0, attempts - 1),
  );
  return new Date(now.getTime() + delay);
}

export function boundedStorageCleanupBatchSize(limit = STORAGE_CLEANUP_DEFAULT_BATCH_SIZE): number {
  if (!Number.isFinite(limit)) return STORAGE_CLEANUP_DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(Math.floor(limit), STORAGE_CLEANUP_MAX_BATCH_SIZE));
}

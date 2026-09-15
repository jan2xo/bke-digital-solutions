export type StorageCleanupStatus =
  | "PENDING"
  | "PROCESSING"
  | "RETRYING"
  | "SUCCEEDED"
  | "FAILED";

export type StorageCleanupJob = Readonly<{
  id: string;
  type: string;
  targetType: string;
  targetId: string;
  objectKey: string;
  productId?: string | null;
  artifactId?: string | null;
  createdByActorId?: string | null;
  correlationId: string;
  idempotencyKey: string;
  status: StorageCleanupStatus;
  attempts: number;
  nextAttemptAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  lastErrorCode?: string | null;
}>;

export type QueueStorageCleanupInput = Readonly<{
  type: string;
  targetType: string;
  targetId: string;
  objectKey: string;
  productId?: string;
  artifactId?: string;
  actorId?: string;
  correlationId?: string;
}>;

export interface StorageCleanupStore {
  upsertQueued(input: Readonly<{
    job: Omit<StorageCleanupJob, "id">;
  }>): Promise<StorageCleanupJob>;
  get(id: string): Promise<StorageCleanupJob | null>;
  claim(input: Readonly<{ id: string; now: Date }>): Promise<boolean>;
  recoverAbandoned(input: Readonly<{
    startedBefore: Date;
    retryAt: Date;
    errorCode: string;
  }>): Promise<number>;
  requestRetry(input: Readonly<{ id: string; retryAt: Date }>): Promise<void>;
  markSucceeded(input: Readonly<{
    id: string;
    completedAt: Date;
  }>): Promise<void>;
  markRetrying(input: Readonly<{
    id: string;
    nextAttemptAt: Date;
    lastErrorCode: string;
  }>): Promise<void>;
  markFailed(input: Readonly<{
    id: string;
    completedAt: Date;
    lastErrorCode: string;
  }>): Promise<void>;
  listReady(input: Readonly<{ now: Date; limit: number }>): Promise<readonly string[]>;
}

export interface StorageCleanupEligibilityGuard {
  canDelete(job: StorageCleanupJob): Promise<Readonly<{
    allowed: boolean;
    code?: string;
  }>>;
}

export interface StorageObjectDeleter {
  deleteObject(objectKey: string): Promise<void>;
}

export type StorageCleanupOperationalEvent = Readonly<{
  action:
    | "STORAGE_CLEANUP_RETRY_REQUESTED"
    | "STORAGE_CLEANUP_COMPLETED"
    | "STORAGE_CLEANUP_RETRY_SCHEDULED"
    | "STORAGE_CLEANUP_FAILED";
  jobId: string;
  targetType: string;
  targetId: string;
  actorId?: string | null;
  attempts: number;
  errorCode?: string;
  terminal?: boolean;
}>;

export interface StorageCleanupOperationalEventSink {
  emit(event: StorageCleanupOperationalEvent): Promise<void>;
}

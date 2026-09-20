export type ScheduledJobTrigger =
  | "SCHEDULED"
  | "RETRY"
  | "MANUAL"
  | "CRON"
  | "CLI"
  | "CERTIFICATION";

export type JobFailureClass =
  | "TRANSIENT"
  | "PERMANENT"
  | "CONFIGURATION"
  | "DEPENDENCY_UNAVAILABLE"
  | "VALIDATION"
  | "CONCURRENCY_CONFLICT";

export type ScheduledRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "RETRYING"
  | "ABANDONED"
  | "CANCELLED"
  | "SKIPPED";

export type JobSummary = Record<string, string | number | boolean | null>;

export type JobContext = Readonly<{
  now: Date;
  dryRun: boolean;
  correlationId: string;
}>;

export type ScheduledJob = Readonly<{
  key: string;
  name: string;
  description: string;
  category: string;
  cadenceSeconds: number;
  timeoutSeconds: number;
  lockSeconds: number;
  maxAttempts: number;
  dryRunSupported: boolean;
  healthThresholdSeconds: number;
  auditPolicy: "FAILURES" | "ALL";
  handler(context: JobContext): Promise<JobSummary>;
}>;

export type RunJobInput = Readonly<{
  key: string;
  trigger: ScheduledJobTrigger;
  scheduledFor?: Date;
  dryRun?: boolean;
  idempotencyKey?: string;
  parentRunId?: string;
}>;

export type ScheduledJobDefinition = Readonly<{
  key: string;
  enabled: boolean;
  cadenceSeconds: number;
  timeoutSeconds: number;
  maxAttempts: number;
  nextRunAt: Date;
}>;

export type ScheduledJobRun = Readonly<{
  id: string;
  jobKey: string;
  status: ScheduledRunStatus;
  attempt: number;
  scheduledFor: Date;
  startedAt?: Date | null;
  retryAt?: Date | null;
}>;

export type SchedulerLock = Readonly<{
  key: string;
  owner: string;
}>;

export interface SchedulerLockProvider {
  acquire(jobKey: string, ttlMs: number): Promise<SchedulerLock | null>;
  release(lock: SchedulerLock): Promise<void>;
}

export type SchedulerEvent = Readonly<{
  action:
    | "SCHEDULER_LOCK_CONFLICT"
    | "SCHEDULER_JOB_SUCCEEDED"
    | "SCHEDULER_JOB_RETRY_SCHEDULED"
    | "SCHEDULER_JOB_FAILED"
    | "SCHEDULER_JOB_ABANDONED"
    | "SCHEDULER_JOB_ENABLED"
    | "SCHEDULER_JOB_DISABLED"
    | "SCHEDULER_FAILURE_ACKNOWLEDGED"
    | "SCHEDULER_JOB_RETRY_REQUESTED";
  targetType: "ScheduledJob" | "ScheduledJobRun";
  targetId: string;
  actorId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}>;

export interface SchedulerEventSink {
  emit(event: SchedulerEvent): Promise<void>;
}

export interface SchedulerStore {
  synchronizeDefinition(input: Readonly<{
    job: ScheduledJob;
    initialNextRunAt: Date;
  }>): Promise<void>;
  getDefinition(key: string): Promise<ScheduledJobDefinition>;
  getRun(id: string): Promise<ScheduledJobRun | null>;
  createRun(input: Readonly<{
    jobKey: string;
    scheduledFor: Date;
    trigger: ScheduledJobTrigger;
    dryRun: boolean;
    correlationId: string;
    idempotencyKey: string;
    parentRunId?: string;
    attempt: number;
  }>): Promise<Readonly<{ created: boolean; run: ScheduledJobRun }>>;
  markLockConflict(input: Readonly<{
    runId: string;
    completedAt: Date;
  }>): Promise<void>;
  markRunning(input: Readonly<{
    runId: string;
    startedAt: Date;
    lockOwner: string;
  }>): Promise<void>;
  markSucceeded(input: Readonly<{
    runId: string;
    completedAt: Date;
    durationMs: number;
    resultSummary: JobSummary;
    nextRunAt: Date;
  }>): Promise<void>;
  markFailed(input: Readonly<{
    runId: string;
    completedAt: Date;
    durationMs: number;
    errorCode: string;
    failureClass: JobFailureClass;
    retryAt: Date | null;
    nextRunAt: Date;
  }>): Promise<void>;
  listRunning(limit: number): Promise<readonly ScheduledJobRun[]>;
  markAbandoned(input: Readonly<{
    runId: string;
    completedAt: Date;
    durationMs: number;
    retryable: boolean;
  }>): Promise<void>;
  listDueRetries(now: Date, limit: number): Promise<readonly ScheduledJobRun[]>;
  consumeRetrySource(runId: string): Promise<boolean>;
  listDueDefinitions(now: Date, limit: number): Promise<readonly ScheduledJobDefinition[]>;
  setEnabled(input: Readonly<{ key: string; enabled: boolean; nextRunAt?: Date }>): Promise<void>;
  acknowledgeFailure(input: Readonly<{ runId: string; actorId: string; acknowledgedAt: Date }>): Promise<void>;
}

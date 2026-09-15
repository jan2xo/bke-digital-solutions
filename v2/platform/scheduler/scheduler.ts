import { randomUUID } from "node:crypto";
import type {
  RunJobInput,
  ScheduledJob,
  ScheduledJobRun,
  ScheduledJobTrigger,
  SchedulerEvent,
  SchedulerEventSink,
  SchedulerLockProvider,
  SchedulerStore,
} from "./contracts";
import {
  boundedJobSummary,
  classifyJobFailure,
  nextScheduledAt,
  retryDelayMs,
  safeJobErrorCode,
  scheduledIdempotencyKey,
  scheduledWindow,
  withJobTimeout,
} from "./policy";
import { createSchedulerRegistry } from "./registry";

export type SchedulerEngine = Readonly<{
  synchronizeJobs(now?: Date): Promise<number>;
  runJob(input: RunJobInput): Promise<unknown>;
  recoverAbandonedRuns(now?: Date): Promise<number>;
  runDueJobs(trigger?: ScheduledJobTrigger, now?: Date): Promise<Readonly<{
    recovered: number;
    retries: number;
    due: number;
    results: readonly unknown[];
  }>>;
  setJobEnabled(key: string, enabled: boolean, actorId: string): Promise<void>;
  acknowledgeFailure(runId: string, actorId: string): Promise<void>;
  retryFailure(runId: string, actorId: string): Promise<unknown>;
}>;

export function createSchedulerEngine(dependencies: Readonly<{
  jobs: readonly ScheduledJob[];
  store: SchedulerStore;
  locks: SchedulerLockProvider;
  events?: SchedulerEventSink;
  now?: () => Date;
  randomId?: () => string;
}>): SchedulerEngine {
  const registry = createSchedulerRegistry(dependencies.jobs);
  const clock = dependencies.now ?? (() => new Date());
  const randomId = dependencies.randomId ?? randomUUID;

  async function emit(event: SchedulerEvent): Promise<void> {
    await dependencies.events?.emit(event);
  }

  async function synchronizeJobs(now = clock()): Promise<number> {
    for (const job of registry.jobs) {
      await dependencies.store.synchronizeDefinition({
        job,
        initialNextRunAt: scheduledWindow(now, job.cadenceSeconds),
      });
    }
    return registry.jobs.length;
  }

  async function runJob(input: RunJobInput): Promise<unknown> {
    const job = registry.get(input.key);
    const now = clock();
    await synchronizeJobs(now);
    const definition = await dependencies.store.getDefinition(job.key);

    if (!definition.enabled) return { skipped: true as const, reason: "JOB_PAUSED" };
    if (input.dryRun && !job.dryRunSupported) throw new Error("DRY_RUN_NOT_SUPPORTED");

    const scheduledFor =
      input.scheduledFor ??
      (input.trigger === "SCHEDULED" || input.trigger === "CRON"
        ? scheduledWindow(now, job.cadenceSeconds)
        : now);
    const idempotencyKey =
      input.idempotencyKey ??
      (input.trigger === "SCHEDULED" || input.trigger === "CRON"
        ? scheduledIdempotencyKey(job.key, scheduledFor, input.dryRun)
        : `${job.key}:${input.trigger.toLowerCase()}:${randomId()}`);
    const correlationId = randomId();
    const parent = input.parentRunId
      ? await dependencies.store.getRun(input.parentRunId)
      : null;

    const created = await dependencies.store.createRun({
      jobKey: job.key,
      scheduledFor,
      trigger: input.trigger,
      dryRun: Boolean(input.dryRun),
      correlationId,
      idempotencyKey,
      parentRunId: input.parentRunId,
      attempt: (parent?.attempt ?? 0) + 1,
    });

    if (!created.created) {
      return { duplicate: true as const, run: created.run };
    }

    const run = created.run;
    const lock = await dependencies.locks.acquire(job.key, job.lockSeconds * 1000);
    if (!lock) {
      await dependencies.store.markLockConflict({ runId: run.id, completedAt: now });
      await emit({
        action: "SCHEDULER_LOCK_CONFLICT",
        targetType: "ScheduledJob",
        targetId: job.key,
        metadata: { runId: run.id, trigger: input.trigger },
      });
      return { skipped: true as const, reason: "LOCK_CONFLICT", runId: run.id };
    }

    const startedAt = clock();
    let releaseLock = true;
    await dependencies.store.markRunning({
      runId: run.id,
      startedAt,
      lockOwner: lock.owner,
    });

    try {
      const summary = await withJobTimeout(
        job.handler({
          now: startedAt,
          dryRun: Boolean(input.dryRun),
          correlationId,
        }),
        job.timeoutSeconds * 1000,
      );
      const completedAt = clock();
      const resultSummary = boundedJobSummary(summary);
      await dependencies.store.markSucceeded({
        runId: run.id,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        resultSummary,
        nextRunAt: nextScheduledAt(
          scheduledFor,
          job.cadenceSeconds,
          completedAt,
        ),
      });

      if (job.auditPolicy === "ALL" || input.trigger === "MANUAL") {
        await emit({
          action: "SCHEDULER_JOB_SUCCEEDED",
          targetType: "ScheduledJob",
          targetId: job.key,
          metadata: {
            runId: run.id,
            trigger: input.trigger,
            dryRun: Boolean(input.dryRun),
          },
        });
      }

      return { succeeded: true as const, runId: run.id, summary };
    } catch (error) {
      const completedAt = clock();
      const failureClass = classifyJobFailure(error);
      const retryable =
        !["PERMANENT", "VALIDATION", "CONFIGURATION"].includes(failureClass) &&
        run.attempt < job.maxAttempts;
      const retryAt = retryable
        ? new Date(completedAt.getTime() + retryDelayMs(run.attempt, completedAt.getTime()))
        : null;
      const errorCode = safeJobErrorCode(error);

      if (errorCode === "SCHEDULED_JOB_TIMEOUT") releaseLock = false;

      await dependencies.store.markFailed({
        runId: run.id,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        errorCode,
        failureClass,
        retryAt,
        nextRunAt:
          retryAt ?? nextScheduledAt(scheduledFor, job.cadenceSeconds, completedAt),
      });
      await emit({
        action: retryable
          ? "SCHEDULER_JOB_RETRY_SCHEDULED"
          : "SCHEDULER_JOB_FAILED",
        targetType: "ScheduledJob",
        targetId: job.key,
        metadata: {
          runId: run.id,
          errorCode,
          failureClass,
          attempt: run.attempt,
        },
      });

      return { succeeded: false as const, runId: run.id, errorCode, retryAt };
    } finally {
      if (releaseLock) {
        await dependencies.locks.release(lock).catch(() => undefined);
      }
    }
  }

  async function recoverAbandonedRuns(now = clock()): Promise<number> {
    const running = await dependencies.store.listRunning(100);
    let recovered = 0;

    for (const run of running) {
      if (!run.startedAt) continue;
      const job = registry.get(run.jobKey);
      if (run.startedAt.getTime() + job.timeoutSeconds * 1000 >= now.getTime()) {
        continue;
      }

      const retryable = run.attempt < job.maxAttempts;
      await dependencies.store.markAbandoned({
        runId: run.id,
        completedAt: now,
        durationMs: now.getTime() - run.startedAt.getTime(),
        retryable,
      });
      await emit({
        action: "SCHEDULER_JOB_ABANDONED",
        targetType: "ScheduledJob",
        targetId: run.jobKey,
        metadata: { runId: run.id, retryable },
      });

      if (retryable) {
        await runJob({
          key: run.jobKey,
          trigger: "RETRY",
          scheduledFor: now,
          idempotencyKey: `retry:${run.id}:${run.attempt + 1}`,
          parentRunId: run.id,
        });
      }
      recovered++;
    }

    return recovered;
  }

  async function runDueJobs(
    trigger: ScheduledJobTrigger = "CRON",
    now = clock(),
  ): Promise<Readonly<{
    recovered: number;
    retries: number;
    due: number;
    results: readonly unknown[];
  }>> {
    await synchronizeJobs(now);
    const recovered = await recoverAbandonedRuns(now);
    const retries = await dependencies.store.listDueRetries(now, 20);
    const results: unknown[] = [];

    for (const prior of retries) {
      const consumed = await dependencies.store.consumeRetrySource(prior.id);
      if (!consumed) continue;
      results.push(
        await runJob({
          key: prior.jobKey,
          trigger: "RETRY",
          scheduledFor: now,
          idempotencyKey: `retry:${prior.id}:${prior.attempt + 1}`,
          parentRunId: prior.id,
        }),
      );
    }

    const due = await dependencies.store.listDueDefinitions(now, 50);
    for (const definition of due) {
      results.push(
        await runJob({
          key: definition.key,
          trigger,
          scheduledFor: scheduledWindow(now, definition.cadenceSeconds),
        }),
      );
    }

    return { recovered, retries: retries.length, due: due.length, results };
  }

  async function setJobEnabled(
    key: string,
    enabled: boolean,
    actorId: string,
  ): Promise<void> {
    registry.get(key);
    await synchronizeJobs();
    await dependencies.store.setEnabled({
      key,
      enabled,
      ...(enabled ? { nextRunAt: clock() } : {}),
    });
    await emit({
      actorId,
      action: enabled ? "SCHEDULER_JOB_ENABLED" : "SCHEDULER_JOB_DISABLED",
      targetType: "ScheduledJob",
      targetId: key,
    });
  }

  async function acknowledgeFailure(runId: string, actorId: string): Promise<void> {
    const run = await dependencies.store.getRun(runId);
    if (!run || (run.status !== "FAILED" && run.status !== "ABANDONED")) {
      throw new Error("INVALID_SCHEDULED_RUN_STATE");
    }
    await dependencies.store.acknowledgeFailure({
      runId,
      actorId,
      acknowledgedAt: clock(),
    });
    await emit({
      actorId,
      action: "SCHEDULER_FAILURE_ACKNOWLEDGED",
      targetType: "ScheduledJobRun",
      targetId: runId,
      metadata: { jobKey: run.jobKey },
    });
  }

  async function retryFailure(runId: string, actorId: string): Promise<unknown> {
    const run = await dependencies.store.getRun(runId);
    if (
      !run ||
      !["FAILED", "ABANDONED", "RETRYING"].includes(run.status)
    ) {
      throw new Error("INVALID_SCHEDULED_RUN_STATE");
    }
    await emit({
      actorId,
      action: "SCHEDULER_JOB_RETRY_REQUESTED",
      targetType: "ScheduledJobRun",
      targetId: runId,
      metadata: { jobKey: run.jobKey },
    });
    return runJob({
      key: run.jobKey,
      trigger: "RETRY",
      scheduledFor: clock(),
      idempotencyKey: `manual-retry:${run.id}:${randomId()}`,
      parentRunId: run.id,
    });
  }

  return Object.freeze({
    synchronizeJobs,
    runJob,
    recoverAbandonedRuns,
    runDueJobs,
    setJobEnabled,
    acknowledgeFailure,
    retryFailure,
  });
}

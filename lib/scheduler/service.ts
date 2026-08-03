import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, ScheduledJobTrigger } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { acquireSchedulerLock, releaseSchedulerLock } from "@/lib/scheduler/lock";
import { classifyJobFailure, retryDelayMs, safeJobErrorCode, scheduledIdempotencyKey, scheduledWindow } from "@/lib/scheduler/policy";
import { scheduledJob, scheduledJobs } from "@/lib/scheduler/registry";
import type { JobSummary, RunJobInput } from "@/lib/scheduler/types";

function boundedSummary(summary: JobSummary): Prisma.InputJsonValue {
  const entries = Object.entries(summary).slice(0, 30).map(([key, value]) => [key.slice(0, 80), typeof value === "string" ? value.slice(0, 200) : value]);
  return Object.fromEntries(entries) as Prisma.InputJsonValue;
}
function nextScheduledAt(scheduledFor: Date, cadenceSeconds: number, now = new Date()) {
  const cadence = cadenceSeconds * 1000;
  return new Date(Math.max(scheduledFor.getTime() + cadence, now.getTime() + cadence));
}
async function timeout<T>(promise: Promise<T>, milliseconds: number) {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("SCHEDULED_JOB_TIMEOUT")), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}

export async function synchronizeScheduledJobs(now = new Date()) {
  for (const job of scheduledJobs) await db.scheduledJobDefinition.upsert({
    where: { key: job.key },
    update: { cadenceSeconds: job.cadenceSeconds, timeoutSeconds: job.timeoutSeconds, maxAttempts: job.maxAttempts },
    create: { key: job.key, cadenceSeconds: job.cadenceSeconds, timeoutSeconds: job.timeoutSeconds, maxAttempts: job.maxAttempts, nextRunAt: scheduledWindow(now, job.cadenceSeconds) },
  });
  return scheduledJobs.length;
}

export async function runScheduledJob(input: RunJobInput) {
  const job = scheduledJob(input.key);
  const now = new Date();
  await synchronizeScheduledJobs(now);
  const definition = await db.scheduledJobDefinition.findUniqueOrThrow({ where: { key: job.key } });
  if (!definition.enabled) return { skipped: true as const, reason: "JOB_PAUSED" };
  if (input.dryRun && !job.dryRunSupported) throw new Error("DRY_RUN_NOT_SUPPORTED");
  const scheduledFor = input.scheduledFor ?? (input.trigger === "SCHEDULED" || input.trigger === "CRON" ? scheduledWindow(now, job.cadenceSeconds) : now);
  const idempotencyKey = input.idempotencyKey ?? (input.trigger === "SCHEDULED" || input.trigger === "CRON" ? scheduledIdempotencyKey(job.key, scheduledFor, input.dryRun) : `${job.key}:${input.trigger.toLowerCase()}:${randomUUID()}`);
  const correlationId = randomUUID();
  const parent = input.parentRunId ? await db.scheduledJobRun.findUnique({ where: { id: input.parentRunId }, select: { attempt: true } }) : null;
  const created = await db.scheduledJobRun.createMany({ data: [{ jobKey: job.key, scheduledFor, trigger: input.trigger, dryRun: Boolean(input.dryRun), correlationId, idempotencyKey, parentRunId: input.parentRunId, attempt: (parent?.attempt ?? 0) + 1 }], skipDuplicates: true });
  if (!created.count) return { duplicate: true as const, run: await db.scheduledJobRun.findUnique({ where: { idempotencyKey } }) };
  const run = await db.scheduledJobRun.findUniqueOrThrow({ where: { idempotencyKey } });
  const lock = await acquireSchedulerLock(job.key, job.lockSeconds * 1000);
  if (!lock) {
    await db.$transaction([
      db.scheduledJobRun.update({ where: { id: run.id }, data: { status: "SKIPPED", completedAt: now, durationMs: 0, errorCode: "SCHEDULER_LOCK_CONFLICT", failureClass: "CONCURRENCY_CONFLICT" } }),
      db.auditLog.create({ data: { action: "SCHEDULER_LOCK_CONFLICT", targetType: "ScheduledJob", targetId: job.key, metadata: { runId: run.id, trigger: input.trigger } } }),
    ]);
    return { skipped: true as const, reason: "LOCK_CONFLICT", runId: run.id };
  }
  const startedAt = new Date();
  let releaseLock = true;
  await db.scheduledJobRun.update({ where: { id: run.id }, data: { status: "RUNNING", startedAt, lockOwner: lock.owner } });
  try {
    const summary = await timeout(job.handler({ now: startedAt, dryRun: Boolean(input.dryRun), correlationId }), job.timeoutSeconds * 1000);
    const completedAt = new Date();
    await db.$transaction([
      db.scheduledJobRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", completedAt, durationMs: completedAt.getTime() - startedAt.getTime(), resultSummary: boundedSummary(summary), errorCode: null, failureClass: null } }),
      db.scheduledJobDefinition.update({ where: { key: job.key }, data: { lastRunAt: completedAt, lastSuccessAt: completedAt, consecutiveFailures: 0, nextRunAt: nextScheduledAt(scheduledFor, job.cadenceSeconds, completedAt) } }),
      ...(job.auditPolicy === "ALL" || input.trigger === "MANUAL" ? [db.auditLog.create({ data: { action: "SCHEDULER_JOB_SUCCEEDED", targetType: "ScheduledJob", targetId: job.key, metadata: { runId: run.id, trigger: input.trigger, dryRun: Boolean(input.dryRun) } } })] : []),
    ]);
    return { succeeded: true as const, runId: run.id, summary };
  } catch (error) {
    const completedAt = new Date();
    const failureClass = classifyJobFailure(error);
    const retryable = !["PERMANENT", "VALIDATION", "CONFIGURATION"].includes(failureClass) && run.attempt < job.maxAttempts;
    const retryAt = retryable ? new Date(completedAt.getTime() + retryDelayMs(run.attempt, completedAt.getTime())) : null;
    const errorCode = safeJobErrorCode(error);
    // Promise.race cannot cancel a handler that has already started. Retain the
    // distributed lock until its TTL after a timeout so another worker cannot
    // overlap with the still-settling handler.
    if (errorCode === "SCHEDULED_JOB_TIMEOUT") releaseLock = false;
    await db.$transaction([
      db.scheduledJobRun.update({ where: { id: run.id }, data: { status: retryable ? "RETRYING" : "FAILED", completedAt, durationMs: completedAt.getTime() - startedAt.getTime(), errorCode, failureClass, retryAt } }),
      db.scheduledJobDefinition.update({ where: { key: job.key }, data: { lastRunAt: completedAt, lastFailureAt: completedAt, consecutiveFailures: { increment: 1 }, nextRunAt: retryAt ?? nextScheduledAt(scheduledFor, job.cadenceSeconds, completedAt) } }),
      db.auditLog.create({ data: { action: retryable ? "SCHEDULER_JOB_RETRY_SCHEDULED" : "SCHEDULER_JOB_FAILED", targetType: "ScheduledJob", targetId: job.key, metadata: { runId: run.id, errorCode, failureClass, attempt: run.attempt } } }),
    ]);
    return { succeeded: false as const, runId: run.id, errorCode, retryAt };
  } finally {
    if (releaseLock) await releaseSchedulerLock(lock).catch(() => undefined);
  }
}

export async function recoverAbandonedRuns(now = new Date()) {
  const running = await db.scheduledJobRun.findMany({ where: { status: "RUNNING", startedAt: { not: null } }, include: { definition: true }, take: 100 });
  let recovered = 0;
  for (const run of running) {
    if (!run.startedAt || run.startedAt.getTime() + run.definition.timeoutSeconds * 1000 >= now.getTime()) continue;
    const retryable = run.attempt < run.definition.maxAttempts;
    await db.$transaction([
      db.scheduledJobRun.update({ where: { id: run.id }, data: { status: "ABANDONED", completedAt: now, durationMs: now.getTime() - run.startedAt.getTime(), errorCode: "ABANDONED_AFTER_RESTART", failureClass: "TRANSIENT" } }),
      db.auditLog.create({ data: { action: "SCHEDULER_JOB_ABANDONED", targetType: "ScheduledJob", targetId: run.jobKey, metadata: { runId: run.id, retryable } } }),
    ]);
    if (retryable) await runScheduledJob({ key: run.jobKey, trigger: "RETRY", scheduledFor: now, idempotencyKey: `retry:${run.id}:${run.attempt + 1}`, parentRunId: run.id });
    recovered++;
  }
  return recovered;
}

export async function runDueScheduledJobs(trigger: ScheduledJobTrigger = "CRON", now = new Date()) {
  await synchronizeScheduledJobs(now);
  const recovered = await recoverAbandonedRuns(now);
  const retries = await db.scheduledJobRun.findMany({ where: { status: "RETRYING", retryAt: { lte: now } }, orderBy: { retryAt: "asc" }, take: 20 });
  const results: unknown[] = [];
  for (const prior of retries) {
    await db.scheduledJobRun.update({ where: { id: prior.id }, data: { status: "FAILED" } });
    results.push(await runScheduledJob({ key: prior.jobKey, trigger: "RETRY", scheduledFor: now, idempotencyKey: `retry:${prior.id}:${prior.attempt + 1}`, parentRunId: prior.id }));
  }
  const due = await db.scheduledJobDefinition.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: "asc" }, take: 50 });
  for (const definition of due) results.push(await runScheduledJob({ key: definition.key, trigger, scheduledFor: scheduledWindow(now, definition.cadenceSeconds) }));
  return { recovered, retries: retries.length, due: due.length, results };
}

export async function setScheduledJobEnabled(key: string, enabled: boolean, actorId: string) {
  scheduledJob(key);
  await synchronizeScheduledJobs();
  return db.$transaction([
    db.scheduledJobDefinition.update({ where: { key }, data: { enabled, ...(enabled ? { nextRunAt: new Date() } : {}) } }),
    db.auditLog.create({ data: { actorId, action: enabled ? "SCHEDULER_JOB_ENABLED" : "SCHEDULER_JOB_DISABLED", targetType: "ScheduledJob", targetId: key } }),
  ]);
}

export async function acknowledgeScheduledFailure(runId: string, actorId: string) {
  const run = await db.scheduledJobRun.findUnique({ where: { id: runId } });
  if (!run || !["FAILED", "ABANDONED"].includes(run.status)) throw new Error("INVALID_SCHEDULED_RUN_STATE");
  return db.$transaction([
    db.scheduledJobRun.update({ where: { id: runId }, data: { acknowledgedAt: new Date(), acknowledgedById: actorId } }),
    db.auditLog.create({ data: { actorId, action: "SCHEDULER_FAILURE_ACKNOWLEDGED", targetType: "ScheduledJobRun", targetId: runId, metadata: { jobKey: run.jobKey } } }),
  ]);
}

export async function retryScheduledFailure(runId: string, actorId: string) {
  const run = await db.scheduledJobRun.findUnique({ where: { id: runId } });
  if (!run || !["FAILED", "ABANDONED", "RETRYING"].includes(run.status)) throw new Error("INVALID_SCHEDULED_RUN_STATE");
  await db.auditLog.create({ data: { actorId, action: "SCHEDULER_JOB_RETRY_REQUESTED", targetType: "ScheduledJobRun", targetId: runId, metadata: { jobKey: run.jobKey } } });
  return runScheduledJob({ key: run.jobKey, trigger: "RETRY", scheduledFor: new Date(), idempotencyKey: `manual-retry:${run.id}:${randomUUID()}`, parentRunId: run.id });
}

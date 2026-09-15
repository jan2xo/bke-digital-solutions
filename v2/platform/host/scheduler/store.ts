import "server-only";

import { db } from "@/v2/platform/host/db";
import type {
  ScheduledJobDefinition,
  ScheduledJobRun,
  SchedulerStore,
} from "@/v2/platform/scheduler";

const definitionSelect = {
  key: true,
  enabled: true,
  cadenceSeconds: true,
  timeoutSeconds: true,
  maxAttempts: true,
  nextRunAt: true,
} as const;

const runSelect = {
  id: true,
  jobKey: true,
  status: true,
  attempt: true,
  scheduledFor: true,
  startedAt: true,
  retryAt: true,
} as const;

function definitionSnapshot(row: {
  key: string;
  enabled: boolean;
  cadenceSeconds: number;
  timeoutSeconds: number;
  maxAttempts: number;
  nextRunAt: Date;
}): ScheduledJobDefinition {
  return row;
}

function runSnapshot(row: {
  id: string;
  jobKey: string;
  status: ScheduledJobRun["status"];
  attempt: number;
  scheduledFor: Date;
  startedAt: Date | null;
  retryAt: Date | null;
}): ScheduledJobRun {
  return row;
}

const store: SchedulerStore = {
  async synchronizeDefinition({ job, initialNextRunAt }) {
    await db.scheduledJobDefinition.upsert({
      where: { key: job.key },
      update: {
        cadenceSeconds: job.cadenceSeconds,
        timeoutSeconds: job.timeoutSeconds,
        maxAttempts: job.maxAttempts,
      },
      create: {
        key: job.key,
        cadenceSeconds: job.cadenceSeconds,
        timeoutSeconds: job.timeoutSeconds,
        maxAttempts: job.maxAttempts,
        nextRunAt: initialNextRunAt,
      },
    });
  },

  async getDefinition(key) {
    const row = await db.scheduledJobDefinition.findUniqueOrThrow({
      where: { key },
      select: definitionSelect,
    });
    return definitionSnapshot(row);
  },

  async getRun(id) {
    const row = await db.scheduledJobRun.findUnique({ where: { id }, select: runSelect });
    return row ? runSnapshot(row) : null;
  },

  async createRun(input) {
    const created = await db.scheduledJobRun.createMany({
      data: [{
        jobKey: input.jobKey,
        scheduledFor: input.scheduledFor,
        trigger: input.trigger,
        dryRun: input.dryRun,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        parentRunId: input.parentRunId,
        attempt: input.attempt,
      }],
      skipDuplicates: true,
    });
    const row = await db.scheduledJobRun.findUniqueOrThrow({
      where: { idempotencyKey: input.idempotencyKey },
      select: runSelect,
    });
    return { created: created.count > 0, run: runSnapshot(row) };
  },

  async markLockConflict({ runId, completedAt }) {
    await db.scheduledJobRun.update({
      where: { id: runId },
      data: {
        status: "SKIPPED",
        completedAt,
        durationMs: 0,
        errorCode: "SCHEDULER_LOCK_CONFLICT",
        failureClass: "CONCURRENCY_CONFLICT",
      },
    });
  },

  async markRunning({ runId, startedAt, lockOwner }) {
    await db.scheduledJobRun.update({
      where: { id: runId },
      data: { status: "RUNNING", startedAt, lockOwner },
    });
  },

  async markSucceeded({ runId, completedAt, durationMs, resultSummary, nextRunAt }) {
    const run = await db.scheduledJobRun.findUniqueOrThrow({
      where: { id: runId },
      select: { jobKey: true },
    });
    await db.$transaction([
      db.scheduledJobRun.update({
        where: { id: runId },
        data: {
          status: "SUCCEEDED",
          completedAt,
          durationMs,
          resultSummary,
          errorCode: null,
          failureClass: null,
        },
      }),
      db.scheduledJobDefinition.update({
        where: { key: run.jobKey },
        data: {
          lastRunAt: completedAt,
          lastSuccessAt: completedAt,
          consecutiveFailures: 0,
          nextRunAt,
        },
      }),
    ]);
  },

  async markFailed({ runId, completedAt, durationMs, errorCode, failureClass, retryAt, nextRunAt }) {
    const run = await db.scheduledJobRun.findUniqueOrThrow({
      where: { id: runId },
      select: { jobKey: true },
    });
    await db.$transaction([
      db.scheduledJobRun.update({
        where: { id: runId },
        data: {
          status: retryAt ? "RETRYING" : "FAILED",
          completedAt,
          durationMs,
          errorCode,
          failureClass,
          retryAt,
        },
      }),
      db.scheduledJobDefinition.update({
        where: { key: run.jobKey },
        data: {
          lastRunAt: completedAt,
          lastFailureAt: completedAt,
          consecutiveFailures: { increment: 1 },
          nextRunAt,
        },
      }),
    ]);
  },

  async listRunning(limit) {
    const rows = await db.scheduledJobRun.findMany({
      where: { status: "RUNNING", startedAt: { not: null } },
      orderBy: { startedAt: "asc" },
      take: limit,
      select: runSelect,
    });
    return rows.map(runSnapshot);
  },

  async markAbandoned({ runId, completedAt, durationMs }) {
    await db.scheduledJobRun.update({
      where: { id: runId },
      data: {
        status: "ABANDONED",
        completedAt,
        durationMs,
        errorCode: "ABANDONED_AFTER_RESTART",
        failureClass: "TRANSIENT",
      },
    });
  },

  async listDueRetries(now, limit) {
    const rows = await db.scheduledJobRun.findMany({
      where: { status: "RETRYING", retryAt: { lte: now } },
      orderBy: { retryAt: "asc" },
      take: limit,
      select: runSelect,
    });
    return rows.map(runSnapshot);
  },

  async consumeRetrySource(runId) {
    const changed = await db.scheduledJobRun.updateMany({
      where: { id: runId, status: "RETRYING" },
      data: { status: "FAILED" },
    });
    return changed.count > 0;
  },

  async listDueDefinitions(now, limit) {
    const rows = await db.scheduledJobDefinition.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: "asc" },
      take: limit,
      select: definitionSelect,
    });
    return rows.map(definitionSnapshot);
  },

  async setEnabled({ key, enabled, nextRunAt }) {
    await db.scheduledJobDefinition.update({
      where: { key },
      data: { enabled, ...(nextRunAt ? { nextRunAt } : {}) },
    });
  },

  async acknowledgeFailure({ runId, actorId, acknowledgedAt }) {
    await db.scheduledJobRun.update({
      where: { id: runId },
      data: { acknowledgedAt, acknowledgedById: actorId },
    });
  },
};

export const schedulerStore: SchedulerStore = Object.freeze(store);

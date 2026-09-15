import type { ScheduledRunStatus } from "./contracts";

export type SchedulerHealthJob = Readonly<{
  key: string;
  name: string;
  description: string;
  category: string;
  cadenceSeconds: number;
  healthThresholdSeconds: number;
}>;

export type SchedulerHealthRun = Readonly<{
  status: ScheduledRunStatus;
  durationMs: number | null;
  acknowledgedAt: Date | null;
}> & Readonly<Record<string, unknown>>;

export type SchedulerHealthDefinition<Run extends SchedulerHealthRun = SchedulerHealthRun> = Readonly<{
  key: string;
  enabled: boolean;
  cadenceSeconds: number;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  recentRuns: readonly Run[];
}>;

export type SchedulerHealthStatus = "healthy" | "degraded" | "unhealthy";

export function computeSchedulerHealth<Run extends SchedulerHealthRun>(input: Readonly<{
  now: Date;
  registeredJobs: readonly SchedulerHealthJob[];
  definitions: readonly SchedulerHealthDefinition<Run>[];
}>) {
  const registry = new Map(input.registeredJobs.map((job) => [job.key, job]));
  let status: SchedulerHealthStatus = "healthy";

  const jobs = input.definitions.map((definition) => {
    const job = registry.get(definition.key);
    if (!job) throw new Error("SCHEDULED_JOB_NOT_FOUND");

    const missedBySeconds = Math.max(
      0,
      Math.floor((input.now.getTime() - definition.nextRunAt.getTime()) / 1000),
    );
    const retryBacklog = definition.recentRuns.filter((run) => run.status === "RETRYING").length;
    const failures = definition.recentRuns.filter(
      (run) => run.status === "FAILED" && !run.acknowledgedAt,
    ).length;
    const durations = definition.recentRuns.flatMap((run) =>
      run.durationMs == null ? [] : [run.durationMs],
    );
    const averageDurationMs = durations.length
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : null;

    let health: SchedulerHealthStatus = "healthy";
    if (
      definition.enabled &&
      (missedBySeconds > job.healthThresholdSeconds || definition.consecutiveFailures >= 3)
    ) {
      health = "unhealthy";
    } else if (
      definition.enabled &&
      (missedBySeconds > job.cadenceSeconds || retryBacklog > 0 || definition.consecutiveFailures > 0)
    ) {
      health = "degraded";
    }

    if (health === "unhealthy") status = "unhealthy";
    else if (health === "degraded" && status === "healthy") status = "degraded";

    return {
      key: definition.key,
      name: job.name,
      description: job.description,
      category: job.category,
      enabled: definition.enabled,
      cadenceSeconds: definition.cadenceSeconds,
      nextRunAt: definition.nextRunAt,
      lastRunAt: definition.lastRunAt,
      lastSuccessAt: definition.lastSuccessAt,
      lastFailureAt: definition.lastFailureAt,
      consecutiveFailures: definition.consecutiveFailures,
      retryBacklog,
      failures,
      averageDurationMs,
      health,
      recentRuns: definition.recentRuns,
    };
  });

  return {
    status,
    registeredJobs: input.registeredJobs.length,
    jobs,
  } as const;
}

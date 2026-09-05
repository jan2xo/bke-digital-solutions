import type { ScheduledJob } from "./contracts";

export type SchedulerRegistry = Readonly<{
  jobs: readonly ScheduledJob[];
  get(key: string): ScheduledJob;
}>;

export function createSchedulerRegistry(jobs: readonly ScheduledJob[]): SchedulerRegistry {
  const registry = new Map(jobs.map((job) => [job.key, job]));
  if (registry.size !== jobs.length) throw new Error("DUPLICATE_SCHEDULER_JOB_KEY");

  for (const job of jobs) {
    if (
      !/^[a-z][a-z0-9.-]+$/.test(job.key) ||
      job.timeoutSeconds <= 0 ||
      job.lockSeconds <= job.timeoutSeconds ||
      job.maxAttempts < 1 ||
      job.cadenceSeconds < 30
    ) {
      throw new Error(`INVALID_SCHEDULER_JOB:${job.key}`);
    }
  }

  return Object.freeze({
    jobs: Object.freeze([...jobs]),
    get(key: string): ScheduledJob {
      const job = registry.get(key);
      if (!job) throw new Error("SCHEDULED_JOB_NOT_FOUND");
      return job;
    },
  });
}

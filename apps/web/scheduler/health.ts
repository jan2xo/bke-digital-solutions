import "server-only";
import { synchronizeScheduledJobs } from "@/apps/web/scheduler/service";
import { computeSchedulerHealth } from "@/platform/scheduler";
import { readSchedulerHealthDefinitions } from "@/platform/host/scheduler/health-reader";
import { schedulerJobDefinitions } from "./job-definitions";

export async function schedulerHealth(now = new Date()) {
  await synchronizeScheduledJobs(now);
  const definitions = await readSchedulerHealthDefinitions(20);
  return computeSchedulerHealth({
    now,
    registeredJobs: schedulerJobDefinitions,
    definitions,
  });
}

export type SchedulerHealthSnapshot = Awaited<ReturnType<typeof schedulerHealth>>;

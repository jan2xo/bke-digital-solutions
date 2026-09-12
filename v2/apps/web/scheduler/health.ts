import "server-only";
import { synchronizeScheduledJobs } from "@/lib/scheduler/service";
import { computeSchedulerHealth } from "@/v2/platform/scheduler";
import { readSchedulerHealthDefinitions } from "@/v2/platform/host/scheduler/health-reader";
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

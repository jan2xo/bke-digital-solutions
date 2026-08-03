import "server-only";
import { db } from "@/lib/db";
import { scheduledJob, scheduledJobs } from "@/lib/scheduler/registry";
import { synchronizeScheduledJobs } from "@/lib/scheduler/service";

export async function schedulerHealth(now = new Date()) {
  await synchronizeScheduledJobs(now);
  const definitions = await db.scheduledJobDefinition.findMany({ include: { runs: { orderBy: { createdAt: "desc" }, take: 20 } }, orderBy: { key: "asc" } });
  let status: "healthy" | "degraded" | "unhealthy" = "healthy";
  const jobs = definitions.map((definition) => {
    const registry = scheduledJob(definition.key);
    const missedBySeconds = Math.max(0, Math.floor((now.getTime() - definition.nextRunAt.getTime()) / 1000));
    const retryBacklog = definition.runs.filter((run) => run.status === "RETRYING").length;
    const failures = definition.runs.filter((run) => run.status === "FAILED" && !run.acknowledgedAt).length;
    const durations = definition.runs.flatMap((run) => run.durationMs == null ? [] : [run.durationMs]);
    const averageDurationMs = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null;
    let health: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (definition.enabled && (missedBySeconds > registry.healthThresholdSeconds || definition.consecutiveFailures >= 3)) health = "unhealthy";
    else if (definition.enabled && (missedBySeconds > registry.cadenceSeconds || retryBacklog || definition.consecutiveFailures)) health = "degraded";
    if (health === "unhealthy") status = "unhealthy"; else if (health === "degraded" && status === "healthy") status = "degraded";
    return { key: definition.key, name: registry.name, description: registry.description, category: registry.category, enabled: definition.enabled, cadenceSeconds: definition.cadenceSeconds, nextRunAt: definition.nextRunAt, lastRunAt: definition.lastRunAt, lastSuccessAt: definition.lastSuccessAt, lastFailureAt: definition.lastFailureAt, consecutiveFailures: definition.consecutiveFailures, retryBacklog, failures, averageDurationMs, health, recentRuns: definition.runs };
  });
  return { status, registeredJobs: scheduledJobs.length, jobs };
}

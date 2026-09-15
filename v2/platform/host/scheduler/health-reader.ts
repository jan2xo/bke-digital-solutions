import "server-only";
import { db } from "@/v2/platform/host/db";

export async function readSchedulerHealthDefinitions(recentRunLimit = 20) {
  const definitions = await db.scheduledJobDefinition.findMany({
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: recentRunLimit,
      },
    },
    orderBy: { key: "asc" },
  });

  return definitions.map((definition) => ({
    key: definition.key,
    enabled: definition.enabled,
    cadenceSeconds: definition.cadenceSeconds,
    nextRunAt: definition.nextRunAt,
    lastRunAt: definition.lastRunAt,
    lastSuccessAt: definition.lastSuccessAt,
    lastFailureAt: definition.lastFailureAt,
    consecutiveFailures: definition.consecutiveFailures,
    recentRuns: definition.runs,
  }));
}

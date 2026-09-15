import { describe, expect, it } from "vitest";
import { computeSchedulerHealth } from "../index";

const now = new Date("2026-09-12T04:30:00.000Z");
const job = {
  key: "email.outbox",
  name: "Transactional email outbox",
  description: "Delivers pending mail",
  category: "EMAIL",
  cadenceSeconds: 60,
  healthThresholdSeconds: 300,
} as const;

function definition(overrides: Record<string, unknown> = {}) {
  return {
    key: job.key,
    enabled: true,
    cadenceSeconds: 60,
    nextRunAt: new Date(now.getTime() - 30_000),
    lastRunAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
    recentRuns: [],
    ...overrides,
  };
}

describe("scheduler health", () => {
  it("preserves healthy, degraded and unhealthy threshold semantics", () => {
    expect(computeSchedulerHealth({ now, registeredJobs: [job], definitions: [definition()] }).status).toBe("healthy");
    expect(computeSchedulerHealth({ now, registeredJobs: [job], definitions: [definition({ nextRunAt: new Date(now.getTime() - 61_000) })] }).status).toBe("degraded");
    expect(computeSchedulerHealth({ now, registeredJobs: [job], definitions: [definition({ nextRunAt: new Date(now.getTime() - 301_000) })] }).status).toBe("unhealthy");
    expect(computeSchedulerHealth({ now, registeredJobs: [job], definitions: [definition({ consecutiveFailures: 3 })] }).status).toBe("unhealthy");
  });

  it("counts retry backlog, unacknowledged failures and rounded duration average", () => {
    const result = computeSchedulerHealth({
      now,
      registeredJobs: [job],
      definitions: [definition({
        recentRuns: [
          { status: "RETRYING", durationMs: 100, acknowledgedAt: null },
          { status: "FAILED", durationMs: 201, acknowledgedAt: null },
          { status: "FAILED", durationMs: null, acknowledgedAt: now },
        ],
      })],
    });
    expect(result.status).toBe("degraded");
    expect(result.jobs[0]).toMatchObject({ retryBacklog: 1, failures: 1, averageDurationMs: 151, health: "degraded" });
  });

  it("does not degrade disabled jobs and preserves recent run objects", () => {
    const run = { status: "FAILED" as const, durationMs: 10, acknowledgedAt: null, id: "run-1" };
    const result = computeSchedulerHealth({
      now,
      registeredJobs: [job],
      definitions: [definition({ enabled: false, nextRunAt: new Date(now.getTime() - 999_000), consecutiveFailures: 9, recentRuns: [run] })],
    });
    expect(result.status).toBe("healthy");
    expect(result.jobs[0]?.recentRuns[0]).toBe(run);
  });

  it("rejects persisted definitions that are not in the registered job catalog", () => {
    expect(() => computeSchedulerHealth({
      now,
      registeredJobs: [job],
      definitions: [definition({ key: "unknown.job" })],
    })).toThrow("SCHEDULED_JOB_NOT_FOUND");
  });
});

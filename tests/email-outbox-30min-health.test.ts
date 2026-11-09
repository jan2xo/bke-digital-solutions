import { describe, expect, it } from "vitest";
import { schedulerJobDefinitions } from "@/apps/web/scheduler/job-definitions";
import { computeSchedulerHealth } from "@/platform/scheduler/health";
import { scheduledIdempotencyKey, scheduledWindow } from "@/platform/scheduler/policy";

const outbox = schedulerJobDefinitions.find((job) => job.key === "email.outbox");
if (!outbox) throw new Error("EMAIL_OUTBOX_JOB_MISSING");

describe("30-minute BKE email outbox cadence and health", () => {
  it("aligns email outbox with owner-approved half-hour Cron and leaves other jobs unchanged", () => {
    expect(outbox.cadenceSeconds).toBe(30 * 60);
    expect(outbox.healthThresholdSeconds).toBe(90 * 60);
    expect(schedulerJobDefinitions.find((job) => job.key === "subscriptions.renewal-reminders")?.cadenceSeconds).toBe(3600);
  });

  it("creates two distinct UTC half-hour idempotency windows", () => {
    const earlier = scheduledWindow(new Date("2026-11-09T14:41:12Z"), outbox.cadenceSeconds);
    const later = scheduledWindow(new Date("2026-11-09T15:00:03Z"), outbox.cadenceSeconds);
    expect(earlier.toISOString()).toBe("2026-11-09T14:30:00.000Z");
    expect(later.toISOString()).toBe("2026-11-09T15:00:00.000Z");
    expect(scheduledIdempotencyKey(outbox.key, earlier))
      .not.toBe(scheduledIdempotencyKey(outbox.key, later));
  });

  it("does not falsely flag a healthy 30-minute schedule as late, but detects missed cycles", () => {
    const definition = {
      key: outbox.key,
      enabled: true,
      cadenceSeconds: outbox.cadenceSeconds,
      nextRunAt: new Date("2026-11-09T14:30:00Z"),
      lastRunAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      recentRuns: [],
    };
    const healthAt = (value: string) => computeSchedulerHealth({
      now: new Date(value),
      registeredJobs: [outbox],
      definitions: [definition],
    });
    expect(healthAt("2026-11-09T14:59:00Z").jobs[0].health).toBe("healthy");
    expect(healthAt("2026-11-09T15:03:00Z").jobs[0].health).toBe("degraded");
    expect(healthAt("2026-11-09T16:01:00Z").jobs[0].health).toBe("unhealthy");
  });
});

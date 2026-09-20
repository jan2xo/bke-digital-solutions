import "dotenv/config";
import { describe, expect, it } from "vitest";
import { classifyJobFailure, retryDelayMs, scheduledIdempotencyKey, scheduledWindow } from "@/lib/scheduler/policy";
import { scheduledJob, scheduledJobs } from "@/lib/scheduler/registry";

describe("scheduler policy and registry", () => {
  it("calculates stable execution windows and idempotency keys", () => {
    const now = new Date("2026-08-04T01:02:59.999Z");
    const window = scheduledWindow(now, 60);
    expect(window.toISOString()).toBe("2026-08-04T01:02:00.000Z");
    expect(scheduledIdempotencyKey("email.outbox", window)).toBe("email.outbox:2026-08-04T01:02:00.000Z:live");
    expect(scheduledIdempotencyKey("email.outbox", window, true)).not.toBe(scheduledIdempotencyKey("email.outbox", window));
  });
  it("uses capped exponential backoff with deterministic bounded jitter", () => {
    expect(retryDelayMs(2, 10)).toBeGreaterThanOrEqual(60_000);
    expect(retryDelayMs(8, 10)).toBeLessThanOrEqual(6 * 3600_000 + 72 * 60_000);
  });
  it("classifies failures without persisting exception content", () => {
    expect(classifyJobFailure(new Error("DATABASE_UNAVAILABLE"))).toBe("DEPENDENCY_UNAVAILABLE");
    expect(classifyJobFailure(new Error("INVALID_INPUT"))).toBe("VALIDATION");
    expect(classifyJobFailure(new Error("LOCK_CONFLICT"))).toBe("CONCURRENCY_CONFLICT");
  });
  it("registers unique validated jobs with dry-run handlers", () => {
    expect(new Set(scheduledJobs.map((job) => job.key)).size).toBe(scheduledJobs.length);
    expect(scheduledJobs.length).toBeGreaterThanOrEqual(8);
    expect(scheduledJob("subscriptions.renewal-reminders").dryRunSupported).toBe(true);
    expect(() => scheduledJob("arbitrary.code")).toThrow("SCHEDULED_JOB_NOT_FOUND");
  });
});

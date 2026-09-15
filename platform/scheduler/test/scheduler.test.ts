import { describe, expect, it, vi } from "vitest";
import {
  boundedJobSummary,
  classifyJobFailure,
  createMemorySchedulerLockProvider,
  createSchedulerEngine,
  createSchedulerRegistry,
  retryDelayMs,
  scheduledIdempotencyKey,
  scheduledWindow,
} from "../index";
import type {
  ScheduledJob,
  ScheduledJobDefinition,
  ScheduledJobRun,
  SchedulerEvent,
  SchedulerStore,
} from "../index";

function job(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    key: "email.outbox",
    name: "Email outbox",
    description: "Deliver pending mail",
    category: "EMAIL",
    cadenceSeconds: 60,
    timeoutSeconds: 5,
    lockSeconds: 10,
    maxAttempts: 5,
    dryRunSupported: true,
    healthThresholdSeconds: 300,
    auditPolicy: "FAILURES",
    handler: async () => ({ sent: 1 }),
    ...overrides,
  };
}

function definition(key = "email.outbox"): ScheduledJobDefinition {
  return {
    key,
    enabled: true,
    cadenceSeconds: 60,
    timeoutSeconds: 5,
    maxAttempts: 5,
    nextRunAt: new Date("2026-09-05T01:00:00.000Z"),
  };
}

function run(overrides: Partial<ScheduledJobRun> = {}): ScheduledJobRun {
  return {
    id: "run-1",
    jobKey: "email.outbox",
    status: "QUEUED",
    attempt: 1,
    scheduledFor: new Date("2026-09-05T01:00:00.000Z"),
    startedAt: null,
    retryAt: null,
    ...overrides,
  };
}

function store(overrides: Partial<SchedulerStore> = {}): SchedulerStore {
  return {
    synchronizeDefinition: vi.fn(async () => undefined),
    getDefinition: vi.fn(async (key: string) => definition(key)),
    getRun: vi.fn(async () => null),
    createRun: vi.fn(async (input) => ({
      created: true,
      run: run({
        jobKey: input.jobKey,
        attempt: input.attempt,
        scheduledFor: input.scheduledFor,
      }),
    })),
    markLockConflict: vi.fn(async () => undefined),
    markRunning: vi.fn(async () => undefined),
    markSucceeded: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    listRunning: vi.fn(async () => []),
    markAbandoned: vi.fn(async () => undefined),
    listDueRetries: vi.fn(async () => []),
    consumeRetrySource: vi.fn(async () => true),
    listDueDefinitions: vi.fn(async () => []),
    setEnabled: vi.fn(async () => undefined),
    acknowledgeFailure: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("V2 platform scheduler", () => {
  it("preserves V1 window, idempotency, retry, failure, and bounded-summary policy", () => {
    const now = new Date("2026-09-05T01:02:37.999Z");
    const window = scheduledWindow(now, 60);
    expect(window.toISOString()).toBe("2026-09-05T01:02:00.000Z");
    expect(scheduledIdempotencyKey("email.outbox", window)).toBe(
      "email.outbox:2026-09-05T01:02:00.000Z:live",
    );
    expect(scheduledIdempotencyKey("email.outbox", window, true)).toContain(":dry");
    expect(retryDelayMs(1, 0)).toBe(30_000);
    expect(classifyJobFailure(new Error("DATABASE_UNAVAILABLE"))).toBe(
      "DEPENDENCY_UNAVAILABLE",
    );
    expect(classifyJobFailure(new Error("CONFIG_MISSING"))).toBe("CONFIGURATION");

    const summary = Object.fromEntries(
      Array.from({ length: 35 }, (_, index) => [
        `key-${index}-${"x".repeat(100)}`,
        "v".repeat(250),
      ]),
    );
    const bounded = boundedJobSummary(summary);
    expect(Object.keys(bounded)).toHaveLength(30);
    expect(Object.keys(bounded)[0]?.length).toBeLessThanOrEqual(80);
    expect(String(Object.values(bounded)[0])).toHaveLength(200);
  });

  it("validates injected registries without owning domain handlers", () => {
    expect(() => createSchedulerRegistry([job(), job()])).toThrow(
      "DUPLICATE_SCHEDULER_JOB_KEY",
    );
    expect(() =>
      createSchedulerRegistry([job({ key: "INVALID KEY" })]),
    ).toThrow("INVALID_SCHEDULER_JOB:INVALID KEY");
    expect(createSchedulerRegistry([job()]).get("email.outbox").category).toBe("EMAIL");
    expect(() => createSchedulerRegistry([job()]).get("missing.job")).toThrow(
      "SCHEDULED_JOB_NOT_FOUND",
    );
  });

  it("runs a scheduled job with deterministic window/idempotency, durable state, and lock release", async () => {
    const now = new Date("2026-09-05T01:02:37.999Z");
    const persistence = store();
    const release = vi.fn(async () => undefined);
    const locks = {
      acquire: vi.fn(async (key: string) => ({ key: `lock:${key}`, owner: "owner-1" })),
      release,
    };
    const events: SchedulerEvent[] = [];
    const engine = createSchedulerEngine({
      jobs: [job({ auditPolicy: "ALL" })],
      store: persistence,
      locks,
      events: { emit: async (event) => void events.push(event) },
      now: () => now,
      randomId: () => "random-1",
    });

    await expect(engine.runJob({ key: "email.outbox", trigger: "CRON" })).resolves.toEqual({
      succeeded: true,
      runId: "run-1",
      summary: { sent: 1 },
    });

    expect(persistence.createRun).toHaveBeenCalledWith({
      jobKey: "email.outbox",
      scheduledFor: new Date("2026-09-05T01:02:00.000Z"),
      trigger: "CRON",
      dryRun: false,
      correlationId: "random-1",
      idempotencyKey: "email.outbox:2026-09-05T01:02:00.000Z:live",
      parentRunId: undefined,
      attempt: 1,
    });
    expect(persistence.markRunning).toHaveBeenCalledWith({
      runId: "run-1",
      startedAt: now,
      lockOwner: "owner-1",
    });
    expect(persistence.markSucceeded).toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(events.map((event) => event.action)).toContain("SCHEDULER_JOB_SUCCEEDED");
  });

  it("records lock conflicts without invoking the domain handler", async () => {
    const handler = vi.fn(async () => ({ sent: 1 }));
    const persistence = store();
    const events: SchedulerEvent[] = [];
    const engine = createSchedulerEngine({
      jobs: [job({ handler })],
      store: persistence,
      locks: { acquire: async () => null, release: async () => undefined },
      events: { emit: async (event) => void events.push(event) },
      randomId: () => "id-1",
    });

    await expect(
      engine.runJob({ key: "email.outbox", trigger: "MANUAL" }),
    ).resolves.toMatchObject({ skipped: true, reason: "LOCK_CONFLICT" });
    expect(handler).not.toHaveBeenCalled();
    expect(persistence.markLockConflict).toHaveBeenCalledOnce();
    expect(events[0]?.action).toBe("SCHEDULER_LOCK_CONFLICT");
  });

  it("schedules retryable failures and makes final attempts terminal", async () => {
    const retryStore = store({
      createRun: vi.fn(async (input) => ({
        created: true,
        run: run({ attempt: input.attempt, scheduledFor: input.scheduledFor }),
      })),
    });
    const engine = createSchedulerEngine({
      jobs: [job({ handler: async () => { throw new Error("DATABASE_UNAVAILABLE"); } })],
      store: retryStore,
      locks: createMemorySchedulerLockProvider({ randomId: () => "owner" }),
      now: () => new Date("2026-09-05T01:00:00.000Z"),
      randomId: () => "run-id",
    });

    const retryResult = await engine.runJob({ key: "email.outbox", trigger: "CLI" });
    expect(retryResult).toMatchObject({ succeeded: false, errorCode: "DATABASE_UNAVAILABLE" });
    expect(retryStore.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ failureClass: "DEPENDENCY_UNAVAILABLE" }),
    );
    expect(
      (retryStore.markFailed as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].retryAt,
    ).toBeInstanceOf(Date);

    const terminalStore = store({
      getRun: vi.fn(async () => run({ id: "parent", attempt: 4, status: "FAILED" })),
    });
    const terminal = createSchedulerEngine({
      jobs: [job({ handler: async () => { throw new Error("DATABASE_UNAVAILABLE"); } })],
      store: terminalStore,
      locks: createMemorySchedulerLockProvider({ randomId: () => "owner-2" }),
      now: () => new Date("2026-09-05T01:00:00.000Z"),
      randomId: () => "terminal-id",
    });
    await terminal.runJob({
      key: "email.outbox",
      trigger: "RETRY",
      parentRunId: "parent",
    });
    expect(terminalStore.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ retryAt: null }),
    );
  });

  it("retains the distributed lock after timeout so a settling handler cannot overlap", async () => {
    const release = vi.fn(async () => undefined);
    const persistence = store();
    const engine = createSchedulerEngine({
      jobs: [
        job({
          timeoutSeconds: 0.001,
          lockSeconds: 1,
          handler: async () => new Promise(() => undefined),
        }),
      ],
      store: persistence,
      locks: {
        acquire: async () => ({ key: "lock:email.outbox", owner: "owner-timeout" }),
        release,
      },
      now: () => new Date("2026-09-05T01:00:00.000Z"),
      randomId: () => "timeout-id",
    });

    await expect(engine.runJob({ key: "email.outbox", trigger: "CLI" })).resolves.toMatchObject({
      succeeded: false,
      errorCode: "SCHEDULED_JOB_TIMEOUT",
    });
    expect(release).not.toHaveBeenCalled();
  });

  it("recovers abandoned runs and creates a parent-linked retry", async () => {
    const abandoned = run({
      id: "abandoned-1",
      status: "RUNNING",
      attempt: 1,
      startedAt: new Date("2026-09-05T00:59:00.000Z"),
    });
    const persistence = store({
      listRunning: vi.fn(async () => [abandoned]),
      getRun: vi.fn(async (id: string) => (id === "abandoned-1" ? abandoned : null)),
    });
    const handler = vi.fn(async () => ({ recovered: true }));
    const engine = createSchedulerEngine({
      jobs: [job({ handler })],
      store: persistence,
      locks: createMemorySchedulerLockProvider({ randomId: () => "recovery-owner" }),
      now: () => new Date("2026-09-05T01:00:00.000Z"),
      randomId: () => "recovery-id",
    });

    await expect(
      engine.recoverAbandonedRuns(new Date("2026-09-05T01:00:00.000Z")),
    ).resolves.toBe(1);
    expect(persistence.markAbandoned).toHaveBeenCalledWith({
      runId: "abandoned-1",
      completedAt: new Date("2026-09-05T01:00:00.000Z"),
      durationMs: 60_000,
      retryable: true,
    });
    expect(persistence.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "RETRY",
        parentRunId: "abandoned-1",
        attempt: 2,
        idempotencyKey: "retry:abandoned-1:2",
      }),
    );
  });
});

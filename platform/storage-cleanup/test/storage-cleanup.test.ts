import { describe, expect, it } from "vitest";
import type {
  StorageCleanupJob,
  StorageCleanupOperationalEvent,
  StorageCleanupStore,
} from "../contracts";
import {
  createStorageCleanupPlatform,
  STORAGE_CLEANUP_MAX_ATTEMPTS,
  storageCleanupErrorCode,
  storageCleanupIdempotencyKey,
} from "../index";

type MutableJob = { -readonly [K in keyof StorageCleanupJob]: StorageCleanupJob[K] };

class MemoryStore implements StorageCleanupStore {
  readonly jobs = new Map<string, MutableJob>();
  lastListLimit: number | null = null;
  private nextId = 1;

  async upsertQueued(input: { job: Omit<StorageCleanupJob, "id"> }) {
    const existing = [...this.jobs.values()].find(
      (job) => job.idempotencyKey === input.job.idempotencyKey,
    );
    if (existing) return existing;
    const job = { ...input.job, id: `job-${this.nextId++}` } as MutableJob;
    this.jobs.set(job.id, job);
    return job;
  }

  async get(id: string) {
    return this.jobs.get(id) ?? null;
  }

  async claim(input: { id: string; now: Date }) {
    const job = this.jobs.get(input.id);
    if (
      !job ||
      (job.status !== "PENDING" && job.status !== "RETRYING") ||
      job.nextAttemptAt.getTime() > input.now.getTime()
    ) {
      return false;
    }
    job.status = "PROCESSING";
    job.startedAt = input.now;
    job.attempts += 1;
    return true;
  }

  async recoverAbandoned(input: {
    startedBefore: Date;
    retryAt: Date;
    errorCode: string;
  }) {
    let recovered = 0;
    for (const job of this.jobs.values()) {
      if (
        job.status === "PROCESSING" &&
        job.startedAt &&
        job.startedAt.getTime() < input.startedBefore.getTime()
      ) {
        job.status = "RETRYING";
        job.nextAttemptAt = input.retryAt;
        job.lastErrorCode = input.errorCode;
        recovered += 1;
      }
    }
    return recovered;
  }

  async requestRetry(input: { id: string; retryAt: Date }) {
    const job = this.jobs.get(input.id)!;
    job.status = "RETRYING";
    job.nextAttemptAt = input.retryAt;
    job.lastErrorCode = null;
  }

  async markSucceeded(input: { id: string; completedAt: Date }) {
    const job = this.jobs.get(input.id)!;
    job.status = "SUCCEEDED";
    job.completedAt = input.completedAt;
    job.lastErrorCode = null;
  }

  async markRetrying(input: {
    id: string;
    nextAttemptAt: Date;
    lastErrorCode: string;
  }) {
    const job = this.jobs.get(input.id)!;
    job.status = "RETRYING";
    job.nextAttemptAt = input.nextAttemptAt;
    job.lastErrorCode = input.lastErrorCode;
  }

  async markFailed(input: {
    id: string;
    completedAt: Date;
    lastErrorCode: string;
  }) {
    const job = this.jobs.get(input.id)!;
    job.status = "FAILED";
    job.completedAt = input.completedAt;
    job.lastErrorCode = input.lastErrorCode;
  }

  async listReady(input: { now: Date; limit: number }) {
    this.lastListLimit = input.limit;
    return [...this.jobs.values()]
      .filter(
        (job) =>
          (job.status === "PENDING" || job.status === "RETRYING") &&
          job.nextAttemptAt.getTime() <= input.now.getTime(),
      )
      .slice(0, input.limit)
      .map((job) => job.id);
  }
}

const at = new Date("2026-09-05T01:00:00.000Z");

function fixture(overrides: {
  allowed?: boolean;
  deleteError?: Error;
  events?: StorageCleanupOperationalEvent[];
} = {}) {
  const store = new MemoryStore();
  const deleted: string[] = [];
  const events = overrides.events ?? [];
  const platform = createStorageCleanupPlatform({
    store,
    now: () => at,
    correlationId: () => "correlation-1",
    eligibility: {
      async canDelete() {
        return overrides.allowed === false
          ? { allowed: false, code: "ACTIVE_REFERENCE" }
          : { allowed: true };
      },
    },
    objects: {
      async deleteObject(key) {
        if (overrides.deleteError) throw overrides.deleteError;
        deleted.push(key);
      },
    },
    events: {
      async emit(event) {
        events.push(event);
      },
    },
  });
  return { store, deleted, events, platform };
}

async function queue(platform: ReturnType<typeof fixture>["platform"]) {
  return platform.queue({
    type: "ARTIFACT_REMOVAL",
    targetType: "ProductArtifact",
    targetId: "artifact-1",
    objectKey: "products/a/file.zip",
    actorId: "admin-1",
  });
}

describe("V2 storage cleanup platform", () => {
  it("deduplicates queued work using the V1-compatible SHA-256 key", async () => {
    const { platform, store } = fixture();
    const first = await queue(platform);
    const second = await queue(platform);

    expect(first.id).toBe(second.id);
    expect(store.jobs.size).toBe(1);
    expect(first.idempotencyKey).toBe(
      storageCleanupIdempotencyKey(
        "ARTIFACT_REMOVAL",
        "artifact-1",
        "products/a/file.zip",
      ),
    );
    expect(first.correlationId).toBe("correlation-1");
  });

  it("never deletes when the injected domain eligibility guard rejects the object", async () => {
    const { platform, store, deleted, events } = fixture({ allowed: false });
    const job = await queue(platform);
    const result = await platform.process(job.id, at);

    expect(result).toMatchObject({ claimed: true, succeeded: false, failed: false });
    expect(deleted).toEqual([]);
    expect(store.jobs.get(job.id)?.status).toBe("RETRYING");
    expect(store.jobs.get(job.id)?.attempts).toBe(1);
    expect(events.at(-1)?.action).toBe("STORAGE_CLEANUP_RETRY_SCHEDULED");
    expect(events.at(-1)).not.toHaveProperty("message");
  });

  it("claims once, deletes once, and marks successful work complete", async () => {
    const { platform, store, deleted, events } = fixture();
    const job = await queue(platform);

    const first = await platform.process(job.id, at);
    const second = await platform.process(job.id, at);

    expect(first).toEqual({ claimed: true, succeeded: true });
    expect(second).toEqual({ claimed: false });
    expect(deleted).toEqual(["products/a/file.zip"]);
    expect(store.jobs.get(job.id)?.status).toBe("SUCCEEDED");
    expect(store.jobs.get(job.id)?.attempts).toBe(1);
    expect(events.at(-1)?.action).toBe("STORAGE_CLEANUP_COMPLETED");
  });

  it("becomes terminal on the fifth failed attempt and stores only a safe error code", async () => {
    const failure = new TypeError("secret provider response must never persist");
    const { platform, store, events } = fixture({ deleteError: failure });
    const job = await queue(platform);
    store.jobs.get(job.id)!.attempts = STORAGE_CLEANUP_MAX_ATTEMPTS - 1;

    const result = await platform.process(job.id, at);

    expect(result).toEqual({
      claimed: true,
      succeeded: false,
      failed: true,
      errorCode: storageCleanupErrorCode(failure),
    });
    expect(store.jobs.get(job.id)?.status).toBe("FAILED");
    expect(store.jobs.get(job.id)?.attempts).toBe(STORAGE_CLEANUP_MAX_ATTEMPTS);
    expect(store.jobs.get(job.id)?.lastErrorCode).toBe(storageCleanupErrorCode(failure));
    expect(events.at(-1)).toMatchObject({
      action: "STORAGE_CLEANUP_FAILED",
      terminal: true,
    });
    expect(JSON.stringify(events)).not.toContain("secret provider response");
  });

  it("recovers abandoned processing after the 15-minute timeout", async () => {
    const { platform, store } = fixture();
    const job = await queue(platform);
    const stored = store.jobs.get(job.id)!;
    stored.status = "PROCESSING";
    stored.startedAt = new Date(at.getTime() - 16 * 60_000);

    const recovered = await platform.recoverAbandoned(at);

    expect(recovered).toBe(1);
    expect(stored.status).toBe("RETRYING");
    expect(stored.nextAttemptAt).toEqual(at);
    expect(stored.lastErrorCode).toBe("PROCESSING_TIMEOUT");
  });

  it("allows explicit retry only from failed/retrying states and emits a safe effect", async () => {
    const { platform, store, events } = fixture();
    const job = await queue(platform);
    await expect(platform.retry(job.id, "admin-2", at)).rejects.toThrow("INVALID_STATE");

    store.jobs.get(job.id)!.status = "FAILED";
    await platform.retry(job.id, "admin-2", at);

    expect(store.jobs.get(job.id)?.status).toBe("RETRYING");
    expect(events.at(-1)).toMatchObject({
      action: "STORAGE_CLEANUP_RETRY_REQUESTED",
      actorId: "admin-2",
      jobId: job.id,
    });
  });

  it("caps ready-work batches at 100", async () => {
    const { platform, store } = fixture();
    await platform.processReady(10_000, at);
    expect(store.lastListLimit).toBe(100);
  });
});

import { randomUUID } from "node:crypto";
import type { SchedulerLock, SchedulerLockProvider } from "./contracts";

export function createMemorySchedulerLockProvider(options: Readonly<{
  prefix?: string;
  now?: () => number;
  randomId?: () => string;
}> = {}): SchedulerLockProvider {
  const prefix = options.prefix ?? "bke:scheduler:lock";
  const clock = options.now ?? Date.now;
  const randomId = options.randomId ?? randomUUID;
  const locks = new Map<string, { owner: string; expiresAt: number }>();

  return Object.freeze({
    async acquire(jobKey: string, ttlMs: number): Promise<SchedulerLock | null> {
      const key = `${prefix}:${jobKey}`;
      const current = locks.get(key);
      const now = clock();
      if (current && current.expiresAt > now) return null;
      const owner = randomId();
      locks.set(key, { owner, expiresAt: now + ttlMs });
      return { key, owner };
    },
    async release(lock: SchedulerLock): Promise<void> {
      if (locks.get(lock.key)?.owner === lock.owner) locks.delete(lock.key);
    },
  });
}

export interface DistributedSchedulerLockBackend {
  setIfAbsent(input: Readonly<{
    key: string;
    owner: string;
    ttlMs: number;
  }>): Promise<boolean>;
  deleteIfOwner(input: Readonly<{ key: string; owner: string }>): Promise<void>;
}

export function createDistributedSchedulerLockProvider(options: Readonly<{
  backend: DistributedSchedulerLockBackend;
  prefix: string;
  randomId?: () => string;
}>): SchedulerLockProvider {
  const randomId = options.randomId ?? randomUUID;

  return Object.freeze({
    async acquire(jobKey: string, ttlMs: number): Promise<SchedulerLock | null> {
      const key = `${options.prefix}:scheduler:lock:${jobKey}`;
      const owner = randomId();
      const acquired = await options.backend.setIfAbsent({ key, owner, ttlMs });
      return acquired ? { key, owner } : null;
    },
    async release(lock: SchedulerLock): Promise<void> {
      await options.backend.deleteIfOwner(lock);
    },
  });
}

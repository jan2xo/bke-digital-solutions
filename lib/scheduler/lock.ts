import "server-only";
import { randomUUID } from "node:crypto";
import { Redis as UpstashRedis } from "@upstash/redis";
import { createClient, type RedisClientType } from "redis";
import { env } from "@/lib/env";

const upstash = env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
  ? new UpstashRedis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }) : null;
const globalSchedulerRedis = globalThis as unknown as { schedulerRedis?: RedisClientType };
const redis = env.REDIS_URL ? (globalSchedulerRedis.schedulerRedis ?? createClient({ url: env.REDIS_URL })) : null;
if (redis && env.NODE_ENV !== "production") globalSchedulerRedis.schedulerRedis = redis;
const localLocks = new Map<string, { owner: string; expiresAt: number }>();

export type SchedulerLock = { key: string; owner: string };

export async function acquireSchedulerLock(jobKey: string, ttlMs: number): Promise<SchedulerLock | null> {
  const key = `${env.REDIS_KEY_PREFIX}:scheduler:lock:${jobKey}`;
  const owner = randomUUID();
  if (upstash) {
    const result = await upstash.set(key, owner, { nx: true, px: ttlMs });
    return result === "OK" ? { key, owner } : null;
  }
  if (redis) {
    if (!redis.isOpen) await redis.connect();
    const result = await redis.set(key, owner, { NX: true, PX: ttlMs });
    return result === "OK" ? { key, owner } : null;
  }
  if (env.NODE_ENV === "production") throw new Error("SCHEDULER_LOCK_BACKEND_UNAVAILABLE");
  const current = localLocks.get(key);
  if (current && current.expiresAt > Date.now()) return null;
  localLocks.set(key, { owner, expiresAt: Date.now() + ttlMs });
  return { key, owner };
}

export async function releaseSchedulerLock(lock: SchedulerLock) {
  const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  if (upstash) { await upstash.eval(script, [lock.key], [lock.owner]); return; }
  if (redis) {
    if (!redis.isOpen) await redis.connect();
    await redis.eval(script, { keys: [lock.key], arguments: [lock.owner] });
    return;
  }
  if (localLocks.get(lock.key)?.owner === lock.owner) localLocks.delete(lock.key);
}

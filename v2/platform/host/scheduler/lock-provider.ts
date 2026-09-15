import "server-only";

import { Redis as UpstashRedis } from "@upstash/redis";
import { createClient, type RedisClientType } from "redis";
import { env } from "@/v2/platform/host/env";
import {
  createDistributedSchedulerLockProvider,
  createMemorySchedulerLockProvider,
  type DistributedSchedulerLockBackend,
  type SchedulerLockProvider,
} from "@/v2/platform/scheduler";

const upstash = env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
  ? new UpstashRedis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
  : null;

const globalSchedulerRedis = globalThis as unknown as { schedulerV2Redis?: RedisClientType };
const redis = env.REDIS_URL
  ? (globalSchedulerRedis.schedulerV2Redis ?? createClient({ url: env.REDIS_URL }))
  : null;
if (redis && env.NODE_ENV !== "production") globalSchedulerRedis.schedulerV2Redis = redis;

const backend: DistributedSchedulerLockBackend | null = upstash
  ? {
      async setIfAbsent({ key, owner, ttlMs }) {
        return (await upstash.set(key, owner, { nx: true, px: ttlMs })) === "OK";
      },
      async deleteIfOwner({ key, owner }) {
        const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
        await upstash.eval(script, [key], [owner]);
      },
    }
  : redis
    ? {
        async setIfAbsent({ key, owner, ttlMs }) {
          if (!redis.isOpen) await redis.connect();
          return (await redis.set(key, owner, { NX: true, PX: ttlMs })) === "OK";
        },
        async deleteIfOwner({ key, owner }) {
          if (!redis.isOpen) await redis.connect();
          const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
          await redis.eval(script, { keys: [key], arguments: [owner] });
        },
      }
    : null;

function createHostSchedulerLockProvider(): SchedulerLockProvider {
  if (backend) {
    return createDistributedSchedulerLockProvider({
      backend,
      prefix: env.REDIS_KEY_PREFIX,
    });
  }
  if (env.NODE_ENV === "production") {
    return Object.freeze({
      async acquire() { throw new Error("SCHEDULER_LOCK_BACKEND_UNAVAILABLE"); },
      async release() { throw new Error("SCHEDULER_LOCK_BACKEND_UNAVAILABLE"); },
    });
  }
  return createMemorySchedulerLockProvider({ prefix: `${env.REDIS_KEY_PREFIX}:scheduler:lock` });
}

export const schedulerLockProvider = createHostSchedulerLockProvider();

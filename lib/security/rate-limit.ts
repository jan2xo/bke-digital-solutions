import "server-only";
import { Redis } from "@upstash/redis";
import { createClient, type RedisClientType } from "redis";
import { env } from "@/lib/env";

const redis = env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }) : null;
const globalRedis = globalThis as unknown as { bkeRedis?: RedisClientType };
const localRedis = env.REDIS_URL ? (globalRedis.bkeRedis ?? createClient({ url: env.REDIS_URL })) : null;
if (localRedis && env.NODE_ENV !== "production") globalRedis.bkeRedis = localRedis;
const local = new Map<string, { count: number; reset: number }>();

export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const bucket = `${env.REDIS_KEY_PREFIX}:rl:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  if (redis) {
    try {
      const count = await redis.incr(bucket);
      if (count === 1) await redis.expire(bucket, windowSeconds + 1);
      return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
    } catch {
      return { allowed: false, remaining: 0 };
    }
  }
  if (localRedis) {
    try {
      if (!localRedis.isOpen) await localRedis.connect();
      const count = await localRedis.incr(bucket);
      if (count === 1) await localRedis.expire(bucket, windowSeconds + 1);
      return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
    } catch {
      return { allowed: false, remaining: 0 };
    }
  }
  if (env.NODE_ENV === "production") throw new Error("Distributed rate limiter is not configured");
  const now = Date.now();
  const entry = local.get(bucket);
  const next = !entry || entry.reset < now ? { count: 1, reset: now + windowSeconds * 1000 } : { ...entry, count: entry.count + 1 };
  local.set(bucket, next);
  return { allowed: next.count <= limit, remaining: Math.max(0, limit - next.count) };
}

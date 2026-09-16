import "server-only";
import { Redis } from "@upstash/redis";
import { createClient, type RedisClientType } from "redis";
import { getWebHostEnvironment } from "../config/environment";

const environment = getWebHostEnvironment();
const upstash =
  environment.upstashRedisRestUrl && environment.upstashRedisRestToken
    ? new Redis({
        url: environment.upstashRedisRestUrl,
        token: environment.upstashRedisRestToken,
      })
    : null;
const globalRedis = globalThis as unknown as { bkeV2WebRedis?: RedisClientType };
const localRedis = environment.redisUrl
  ? (globalRedis.bkeV2WebRedis ?? createClient({ url: environment.redisUrl }))
  : null;
if (localRedis && environment.nodeEnv !== "production") globalRedis.bkeV2WebRedis = localRedis;
const local = new Map<string, { count: number; reset: number }>();

export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const bucket = `${environment.redisKeyPrefix}:rl:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  if (upstash) {
    try {
      const count = await upstash.incr(bucket);
      if (count === 1) await upstash.expire(bucket, windowSeconds + 1);
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
  if (environment.nodeEnv === "production") {
    throw new Error("Distributed rate limiter is not configured");
  }
  const now = Date.now();
  const entry = local.get(bucket);
  const next =
    !entry || entry.reset < now
      ? { count: 1, reset: now + windowSeconds * 1000 }
      : { ...entry, count: entry.count + 1 };
  local.set(bucket, next);
  return { allowed: next.count <= limit, remaining: Math.max(0, limit - next.count) };
}

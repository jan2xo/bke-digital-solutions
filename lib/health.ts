import "server-only";
import { Redis as UpstashRedis } from "@upstash/redis";
import { createClient } from "redis";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { checkStorageReadiness } from "@/lib/storage";
import { operationalLog } from "@/lib/logger";
import { resolvePayMongoConfiguration, resolveResendConfiguration } from "@/lib/provider-config/service";

type Dependency = "postgresql" | "valkey" | "objectStorage" | "providers";

async function withinTimeout(operation: () => Promise<unknown>, milliseconds = 3_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("DEPENDENCY_TIMEOUT")), milliseconds); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkValkey() {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    await new UpstashRedis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }).ping();
    return;
  }
  if (!env.REDIS_URL) throw new Error("VALKEY_NOT_CONFIGURED");
  const client = createClient({ url: env.REDIS_URL, socket: { connectTimeout: 2_500 } });
  try { await client.connect(); await client.ping(); } finally { if (client.isOpen) await client.quit(); }
}

export async function readiness() {
  const checks: Record<Dependency, "up" | "down"> = { postgresql: "down", valkey: "down", objectStorage: "down", providers: "down" };
  const operations: Array<[Dependency, () => Promise<unknown>]> = [
    ["postgresql", () => db.$queryRaw`SELECT 1`],
    ["valkey", checkValkey],
    ["objectStorage", () => checkStorageReadiness(AbortSignal.timeout(3_000))],
    ["providers", async () => {
      if (env.PAYMENT_PROVIDER === "paymongo") await resolvePayMongoConfiguration();
      if (env.EMAIL_PROVIDER === "resend") await resolveResendConfiguration();
    }],
  ];
  await Promise.all(operations.map(async ([name, operation]) => {
    try { await withinTimeout(operation); checks[name] = "up"; }
    catch { operationalLog("warn", "readiness_dependency_failed", { dependency: name, errorCode: "DEPENDENCY_UNAVAILABLE" }); }
  }));
  return { ready: Object.values(checks).every((status) => status === "up"), checks };
}

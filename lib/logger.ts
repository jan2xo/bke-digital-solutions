import "server-only";
import { env } from "@/lib/env";

type Context = Record<string, unknown>;
const sensitiveKey = /(password|secret|token|cookie|authorization|signature|licensekey|checkouturl|payload|body|email)/i;

function safeContext(context: Context) {
  return Object.fromEntries(Object.entries(context).map(([key, value]) => [key, sensitiveKey.test(key) ? "[REDACTED]" : value]));
}

export function operationalLog(level: "info" | "warn" | "error", operation: string, context: Context = {}) {
  const levels = ["debug", "info", "warn", "error"];
  if (levels.indexOf(level) < levels.indexOf(env.LOG_LEVEL)) return;
  const record = JSON.stringify({ timestamp: new Date().toISOString(), severity: level, environment: env.DEPLOYMENT_ENV, operation, ...safeContext(context) });
  if (level === "error") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.info(record);
}

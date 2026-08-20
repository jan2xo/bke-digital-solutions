import "server-only";
import { env } from "@/lib/env";
import { redact } from "@/lib/redaction";

type Context = Record<string, unknown>;
function redactLogEmails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLogEmails);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, key.toLowerCase().includes("email") ? "[REDACTED]" : redactLogEmails(nested)]));
  return value;
}
function safeContext(context: Context) {
  return redactLogEmails(redact(context)) as Context;
}

export function operationalLog(level: "info" | "warn" | "error", operation: string, context: Context = {}) {
  const levels = ["debug", "info", "warn", "error"];
  if (levels.indexOf(level) < levels.indexOf(env.LOG_LEVEL)) return;
  const record = JSON.stringify({ timestamp: new Date().toISOString(), severity: level, environment: env.DEPLOYMENT_ENV, operation, ...safeContext(context) });
  if (level === "error") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.info(record);
}

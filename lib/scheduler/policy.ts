import type { JobFailureClass } from "@/lib/scheduler/types";

export function scheduledWindow(now: Date, cadenceSeconds: number) {
  const size = cadenceSeconds * 1000;
  return new Date(Math.floor(now.getTime() / size) * size);
}
export function scheduledIdempotencyKey(key: string, window: Date, dryRun = false) { return `${key}:${window.toISOString()}:${dryRun ? "dry" : "live"}`; }
export function retryDelayMs(attempt: number, seed = 0) { const base = Math.min(6 * 3600_000, 30_000 * 2 ** Math.max(0, attempt - 1)); return base + Math.floor(Math.abs(seed) % Math.max(1, base / 5)); }
export function classifyJobFailure(error: unknown): JobFailureClass {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (/VALID|NOT_FOUND|UNSUPPORTED|PERMANENT/.test(message)) return "VALIDATION";
  if (/CONFIG|CREDENTIAL|ENVIRONMENT/.test(message)) return "CONFIGURATION";
  if (/LOCK|CONCURRENT|CONFLICT/.test(message)) return "CONCURRENCY_CONFLICT";
  if (/UNAVAILABLE|ECONN|TIMEOUT|NETWORK|REDIS|DATABASE/.test(message)) return "DEPENDENCY_UNAVAILABLE";
  return "TRANSIENT";
}
export function safeJobErrorCode(error: unknown) {
  const value = error instanceof Error ? error.message : "SCHEDULED_JOB_FAILED";
  return value.replace(/[^A-Z0-9_:-]/gi, "_").slice(0, 80) || "SCHEDULED_JOB_FAILED";
}

import type { JobFailureClass, JobSummary } from "./contracts";

export function scheduledWindow(now: Date, cadenceSeconds: number): Date {
  const size = cadenceSeconds * 1000;
  return new Date(Math.floor(now.getTime() / size) * size);
}

export function scheduledIdempotencyKey(
  key: string,
  window: Date,
  dryRun = false,
): string {
  return `${key}:${window.toISOString()}:${dryRun ? "dry" : "live"}`;
}

export function retryDelayMs(attempt: number, seed = 0): number {
  const base = Math.min(6 * 3600_000, 30_000 * 2 ** Math.max(0, attempt - 1));
  return base + Math.floor(Math.abs(seed) % Math.max(1, base / 5));
}

export function classifyJobFailure(error: unknown): JobFailureClass {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (/VALID|NOT_FOUND|UNSUPPORTED|PERMANENT/.test(message)) return "VALIDATION";
  if (/CONFIG|CREDENTIAL|ENVIRONMENT/.test(message)) return "CONFIGURATION";
  if (/LOCK|CONCURRENT|CONFLICT/.test(message)) return "CONCURRENCY_CONFLICT";
  if (/UNAVAILABLE|ECONN|TIMEOUT|NETWORK|REDIS|DATABASE/.test(message)) {
    return "DEPENDENCY_UNAVAILABLE";
  }
  return "TRANSIENT";
}

export function safeJobErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : "SCHEDULED_JOB_FAILED";
  return value.replace(/[^A-Z0-9_:-]/gi, "_").slice(0, 80) || "SCHEDULED_JOB_FAILED";
}

export function boundedJobSummary(summary: JobSummary): JobSummary {
  return Object.fromEntries(
    Object.entries(summary)
      .slice(0, 30)
      .map(([key, value]) => [
        key.slice(0, 80),
        typeof value === "string" ? value.slice(0, 200) : value,
      ]),
  );
}

export function nextScheduledAt(
  scheduledFor: Date,
  cadenceSeconds: number,
  now: Date,
): Date {
  const cadence = cadenceSeconds * 1000;
  return new Date(
    Math.max(scheduledFor.getTime() + cadence, now.getTime() + cadence),
  );
}

export async function withJobTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("SCHEDULED_JOB_TIMEOUT")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

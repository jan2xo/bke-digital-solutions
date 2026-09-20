import type {
  CoreReadinessDependencies,
  HealthProbe,
  ReadinessEventSink,
  ReadinessResult,
} from "./contracts";

export function liveness(): Readonly<{ status: "alive" }> {
  return Object.freeze({ status: "alive" });
}

export async function withinHealthTimeout<T>(
  operation: () => Promise<T>,
  milliseconds = 3_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("DEPENDENCY_TIMEOUT")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createReadinessChecker(options: Readonly<{
  probes: readonly HealthProbe[];
  events?: ReadinessEventSink;
  defaultTimeoutMs?: number;
}>): (correlationId?: string) => Promise<ReadinessResult> {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 3_000;
  const names = new Set(options.probes.map((probe) => probe.name));
  if (names.size !== options.probes.length) {
    throw new Error("DUPLICATE_HEALTH_PROBE");
  }
  if (
    options.probes.some(
      (probe) => !probe.name || (probe.timeoutMs ?? defaultTimeoutMs) <= 0,
    )
  ) {
    throw new Error("INVALID_HEALTH_PROBE");
  }

  return async (correlationId?: string): Promise<ReadinessResult> => {
    const checks: Record<string, "up" | "down"> = Object.fromEntries(
      options.probes.map((probe) => [probe.name, "down"]),
    );

    await Promise.all(
      options.probes.map(async (probe) => {
        try {
          await withinHealthTimeout(
            probe.check,
            probe.timeoutMs ?? defaultTimeoutMs,
          );
          checks[probe.name] = "up";
        } catch {
          await options.events?.emit({
            event: "readiness_dependency_failed",
            dependency: probe.name,
            errorCode: "DEPENDENCY_UNAVAILABLE",
            ...(correlationId ? { correlationId } : {}),
          });
        }
      }),
    );

    return Object.freeze({
      ready: Object.values(checks).every((status) => status === "up"),
      checks: Object.freeze({ ...checks }),
    });
  };
}

export function createCoreReadinessChecker(options: Readonly<{
  dependencies: CoreReadinessDependencies;
  events?: ReadinessEventSink;
  timeoutMs?: number;
}>): (correlationId?: string) => Promise<ReadinessResult> {
  return createReadinessChecker({
    probes: [
      { name: "postgresql", check: options.dependencies.postgresql },
      { name: "valkey", check: options.dependencies.valkey },
      { name: "objectStorage", check: options.dependencies.objectStorage },
      { name: "providers", check: options.dependencies.providers },
    ],
    events: options.events,
    defaultTimeoutMs: options.timeoutMs ?? 3_000,
  });
}

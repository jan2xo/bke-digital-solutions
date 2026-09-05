export type HealthDependencyStatus = "up" | "down";

export type HealthProbe = Readonly<{
  name: string;
  timeoutMs?: number;
  check(): Promise<unknown>;
}>;

export type ReadinessResult = Readonly<{
  ready: boolean;
  checks: Readonly<Record<string, HealthDependencyStatus>>;
}>;

export type ReadinessFailureEvent = Readonly<{
  event: "readiness_dependency_failed";
  dependency: string;
  errorCode: "DEPENDENCY_UNAVAILABLE";
  correlationId?: string;
}>;

export interface ReadinessEventSink {
  emit(event: ReadinessFailureEvent): Promise<void> | void;
}

export type CoreReadinessDependencies = Readonly<{
  postgresql(): Promise<unknown>;
  valkey(): Promise<unknown>;
  objectStorage(): Promise<unknown>;
  providers(): Promise<unknown>;
}>;

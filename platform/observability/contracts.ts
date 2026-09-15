export type HealthState = "HEALTHY" | "WARNING" | "CRITICAL";
export type MetricValue = number | string | boolean | null;

export type PlatformMetric = Readonly<{
  key: string;
  value: MetricValue;
  unit?: string;
  state: HealthState;
  observedAt: string;
}>;

export type ObservabilityCard = Readonly<{
  key: string;
  label: string;
  state: HealthState;
  summary: string;
  metrics: readonly PlatformMetric[];
}>;

export interface ObservabilitySource {
  collect(observedAt: Date): Promise<ObservabilityCard | readonly ObservabilityCard[]>;
}

export type ObservabilitySnapshot = Readonly<{
  observedAt: string;
  overall: HealthState;
  cards: readonly ObservabilityCard[];
}>;

export type ObservabilityAlertSeverity = "WARNING" | "CRITICAL";

export type ObservabilityAlert = Readonly<{
  id: string;
  fingerprint: string;
  source: string;
  title: string;
  detail: string;
  severity: ObservabilityAlertSeverity;
  status: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}>;

export interface ObservabilityAlertStore {
  findActive(fingerprint: string): Promise<ObservabilityAlert | null>;
  refresh(input: Readonly<{
    id: string;
    lastSeenAt: Date;
    detail: string;
    metadata: Readonly<Record<string, unknown>>;
  }>): Promise<void>;
  create(input: Readonly<{
    fingerprint: string;
    source: string;
    title: string;
    detail: string;
    severity: ObservabilityAlertSeverity;
    metadata: Readonly<Record<string, unknown>>;
    firstSeenAt: Date;
    lastSeenAt: Date;
  }>): Promise<ObservabilityAlert>;
  list(): Promise<readonly ObservabilityAlert[]>;
}

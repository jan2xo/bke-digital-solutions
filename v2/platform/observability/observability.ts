import type {
  HealthState,
  MetricValue,
  ObservabilityAlertStore,
  ObservabilityCard,
  ObservabilitySnapshot,
  ObservabilitySource,
  PlatformMetric,
} from "./contracts";

export function stateFor(ok: boolean, warning = false): HealthState {
  return ok ? (warning ? "WARNING" : "HEALTHY") : "CRITICAL";
}

export function metric(
  key: string,
  value: MetricValue,
  state: HealthState,
  observedAt: Date,
  unit?: string,
): PlatformMetric {
  return {
    key,
    value,
    state,
    ...(unit ? { unit } : {}),
    observedAt: observedAt.toISOString(),
  };
}

export function overallHealth(cards: readonly ObservabilityCard[]): HealthState {
  if (cards.some((card) => card.state === "CRITICAL")) return "CRITICAL";
  if (cards.some((card) => card.state === "WARNING")) return "WARNING";
  return "HEALTHY";
}

export async function collectObservability(input: Readonly<{
  sources: readonly ObservabilitySource[];
  now?: () => Date;
}>): Promise<ObservabilitySnapshot> {
  const observedAt = (input.now ?? (() => new Date()))();
  const published = await Promise.all(
    input.sources.map((source) => source.collect(observedAt)),
  );
  const cards = published.flatMap((value) =>
    Array.isArray(value) ? [...value] : [value],
  ) as ObservabilityCard[];

  const keys = new Set<string>();
  for (const card of cards) {
    if (!card.key || keys.has(card.key)) {
      throw new Error("INVALID_OBSERVABILITY_CARD_KEY");
    }
    keys.add(card.key);
  }

  return Object.freeze({
    observedAt: observedAt.toISOString(),
    overall: overallHealth(cards),
    cards: Object.freeze(cards),
  });
}

export async function syncObservabilityAlerts(input: Readonly<{
  snapshot: ObservabilitySnapshot;
  store: ObservabilityAlertStore;
  now?: () => Date;
}>): Promise<readonly ReturnType<ObservabilityAlertStore["list"]> extends Promise<infer T> ? T extends readonly unknown[] ? T[number] : never : never[]> {
  const now = (input.now ?? (() => new Date()))();

  for (const card of input.snapshot.cards) {
    if (card.state === "HEALTHY") continue;
    const severity = card.state;
    const fingerprint = `monitoring:${card.key}:${severity}`;
    const metadata = { metrics: card.metrics } as const;
    const existing = await input.store.findActive(fingerprint);
    if (existing) {
      await input.store.refresh({
        id: existing.id,
        lastSeenAt: now,
        detail: card.summary,
        metadata,
      });
      continue;
    }
    await input.store.create({
      fingerprint,
      source: card.key,
      title: `${card.label} health is ${card.state}`,
      detail: card.summary,
      severity,
      metadata,
      firstSeenAt: now,
      lastSeenAt: now,
    });
  }

  return input.store.list() as never;
}

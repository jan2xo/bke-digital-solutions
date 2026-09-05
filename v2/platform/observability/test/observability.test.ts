import { describe, expect, it } from "vitest";
import type {
  ObservabilityAlert,
  ObservabilityAlertStore,
  ObservabilityCard,
} from "../contracts";
import {
  collectObservability,
  metric,
  overallHealth,
  stateFor,
  syncObservabilityAlerts,
} from "../index";

type MutableAlert = { -readonly [K in keyof ObservabilityAlert]: ObservabilityAlert[K] };

class MemoryAlertStore implements ObservabilityAlertStore {
  readonly alerts: MutableAlert[] = [];
  readonly createdMetadata: Readonly<Record<string, unknown>>[] = [];
  readonly refreshedMetadata: Readonly<Record<string, unknown>>[] = [];

  async findActive(fingerprint: string) {
    return (
      this.alerts.find(
        (alert) =>
          alert.fingerprint === fingerprint &&
          (alert.status === "OPEN" || alert.status === "ACKNOWLEDGED"),
      ) ?? null
    );
  }

  async refresh(input: {
    id: string;
    lastSeenAt: Date;
    detail: string;
    metadata: Readonly<Record<string, unknown>>;
  }) {
    const alert = this.alerts.find((item) => item.id === input.id)!;
    alert.lastSeenAt = input.lastSeenAt;
    alert.detail = input.detail;
    this.refreshedMetadata.push(input.metadata);
  }

  async create(input: {
    fingerprint: string;
    source: string;
    title: string;
    detail: string;
    severity: "WARNING" | "CRITICAL";
    metadata: Readonly<Record<string, unknown>>;
    firstSeenAt: Date;
    lastSeenAt: Date;
  }) {
    const alert: MutableAlert = {
      id: `alert-${this.alerts.length + 1}`,
      ...input,
      status: "OPEN",
    };
    this.alerts.push(alert);
    this.createdMetadata.push(input.metadata);
    return alert;
  }

  async list() {
    return this.alerts;
  }
}

const at = new Date("2026-09-05T02:00:00.000Z");

function card(
  key: string,
  state: "HEALTHY" | "WARNING" | "CRITICAL",
  summary = `${key} summary`,
): ObservabilityCard {
  return {
    key,
    label: key.toUpperCase(),
    state,
    summary,
    metrics: [metric("count", 1, state, at, "items")],
  };
}

describe("V2 observability platform", () => {
  it("preserves the V1 health-state and metric helpers", () => {
    expect(stateFor(true)).toBe("HEALTHY");
    expect(stateFor(true, true)).toBe("WARNING");
    expect(stateFor(false)).toBe("CRITICAL");
    expect(metric("latency", 12, "HEALTHY", at, "ms")).toEqual({
      key: "latency",
      value: 12,
      state: "HEALTHY",
      unit: "ms",
      observedAt: at.toISOString(),
    });
  });

  it("aggregates publisher cards and chooses the most severe overall state", async () => {
    const snapshot = await collectObservability({
      now: () => at,
      sources: [
        { async collect() { return card("alpha", "HEALTHY"); } },
        {
          async collect() {
            return [card("beta", "WARNING"), card("gamma", "CRITICAL")];
          },
        },
      ],
    });

    expect(snapshot.observedAt).toBe(at.toISOString());
    expect(snapshot.cards.map((item) => item.key)).toEqual(["alpha", "beta", "gamma"]);
    expect(snapshot.overall).toBe("CRITICAL");
    expect(overallHealth(snapshot.cards)).toBe("CRITICAL");
  });

  it("rejects duplicate or empty publisher card keys", async () => {
    await expect(
      collectObservability({
        sources: [
          { async collect() { return card("same", "HEALTHY"); } },
          { async collect() { return card("same", "WARNING"); } },
        ],
      }),
    ).rejects.toThrow("INVALID_OBSERVABILITY_CARD_KEY");

    await expect(
      collectObservability({
        sources: [{ async collect() { return card("", "HEALTHY"); } }],
      }),
    ).rejects.toThrow("INVALID_OBSERVABILITY_CARD_KEY");
  });

  it("does not fabricate a healthy snapshot when a publisher fails", async () => {
    await expect(
      collectObservability({
        sources: [
          {
            async collect() {
              throw new Error("PUBLISHER_UNAVAILABLE");
            },
          },
        ],
      }),
    ).rejects.toThrow("PUBLISHER_UNAVAILABLE");
  });

  it("creates alerts only for non-healthy cards with V1-compatible fingerprints", async () => {
    const store = new MemoryAlertStore();
    const snapshot = await collectObservability({
      now: () => at,
      sources: [
        {
          async collect() {
            return [
              card("ok", "HEALTHY"),
              card("slow", "WARNING"),
              card("down", "CRITICAL"),
            ];
          },
        },
      ],
    });

    const alerts = await syncObservabilityAlerts({ snapshot, store, now: () => at });

    expect(alerts).toHaveLength(2);
    expect(alerts.map((alert) => alert.fingerprint)).toEqual([
      "monitoring:slow:WARNING",
      "monitoring:down:CRITICAL",
    ]);
    expect(alerts[0].title).toBe("SLOW health is WARNING");
    expect(store.createdMetadata[0]).toEqual({ metrics: snapshot.cards[1].metrics });
  });

  it("refreshes an active matching alert instead of creating a duplicate", async () => {
    const store = new MemoryAlertStore();
    const firstSnapshot = await collectObservability({
      now: () => at,
      sources: [{ async collect() { return card("queue", "WARNING", "first"); } }],
    });
    await syncObservabilityAlerts({ snapshot: firstSnapshot, store, now: () => at });

    const later = new Date(at.getTime() + 60_000);
    const nextSnapshot = await collectObservability({
      now: () => later,
      sources: [{ async collect() { return card("queue", "WARNING", "second"); } }],
    });
    await syncObservabilityAlerts({ snapshot: nextSnapshot, store, now: () => later });

    expect(store.alerts).toHaveLength(1);
    expect(store.alerts[0].detail).toBe("second");
    expect(store.alerts[0].lastSeenAt).toEqual(later);
    expect(store.refreshedMetadata).toHaveLength(1);
  });

  it("does not resolve or create anything for an all-healthy snapshot", async () => {
    const store = new MemoryAlertStore();
    const snapshot = await collectObservability({
      now: () => at,
      sources: [{ async collect() { return card("clean", "HEALTHY"); } }],
    });

    const alerts = await syncObservabilityAlerts({ snapshot, store, now: () => at });
    expect(alerts).toEqual([]);
  });
});

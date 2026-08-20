import { beforeEach, describe, expect, it, vi } from "vitest";

const collectObservability = vi.fn();
vi.mock("@/lib/observability/metrics", () => ({ collectObservability }));

describe("metrics health endpoint", () => {
  beforeEach(() => collectObservability.mockReset());

  it("returns the current snapshot and disables intermediary caching", async () => {
    const snapshot = {
      overall: "WARNING",
      observedAt: "2026-08-15T14:00:00.000Z",
      cards: [{ key: "email", state: "WARNING", metrics: [] }],
    };
    collectObservability.mockResolvedValue(snapshot);

    const { GET, dynamic } = await import("@/app/api/health/metrics/route");
    const response = await GET();

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(snapshot);
    expect(collectObservability).toHaveBeenCalledOnce();
  });

  it("preserves critical snapshots for the caller", async () => {
    const snapshot = { overall: "CRITICAL", observedAt: "now", cards: [] };
    collectObservability.mockResolvedValue(snapshot);

    const { GET } = await import("@/app/api/health/metrics/route");
    expect(await (await GET()).json()).toEqual(snapshot);
  });
});

describe("observability redaction", () => {
  it("redacts secrets, payloads, and identifying email fields recursively", async () => {
    const { redact } = await import("@/lib/redaction");
    expect(redact({ password: "secret", payload: { email: "person@example.test" }, safe: "ok" })).toEqual({ password: "[REDACTED]", payload: "[REDACTED]", safe: "ok" });
  });
});

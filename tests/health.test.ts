import { beforeEach, describe, expect, it, vi } from "vitest";

const readiness = vi.fn();
vi.mock("@/apps/web/health/readiness", () => ({ readiness }));

describe("operational health endpoints", () => {
  beforeEach(() => readiness.mockReset());
  it("reports liveness without dependency checks", async () => {
    const { GET } = await import("@/app/api/health/live/route");
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "alive" });
    expect(readiness).not.toHaveBeenCalled();
  });
  it("reports generic readiness and a 503 when a dependency is down", async () => {
    readiness.mockResolvedValue({ ready: false, checks: { postgresql: "up", valkey: "down", objectStorage: "up" } });
    const { GET } = await import("@/app/api/health/ready/route");
    const request = new Request("https://example.invalid/api/health/ready", {
      headers: { "x-correlation-id": "health-test-correlation" },
    });
    const response = await GET(request);
    expect(readiness).toHaveBeenCalledWith("health-test-correlation");
    expect(response.status).toBe(503);
    expect(response.headers.get("x-correlation-id")).toBe("health-test-correlation");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "unavailable", dependencies: { postgresql: "up", valkey: "down", objectStorage: "up" } });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const readiness = vi.fn();
vi.mock("@/lib/health", () => ({ readiness }));

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
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable", dependencies: { postgresql: "up", valkey: "down", objectStorage: "up" } });
  });
});

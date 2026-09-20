import { describe, expect, it } from "vitest";
import { validateHealthPayload } from "../scripts/ops-health.mjs";

describe("production ops health contract", () => {
  it("accepts the authoritative live response", () => {
    expect(validateHealthPayload("/api/health/live", 200, { status: "alive" })).toBe(true);
  });
  it("accepts ready only when every reported dependency is up", () => {
    expect(validateHealthPayload("/api/health/ready", 200, { status: "ready", dependencies: { postgresql: "up", valkey: "up", objectStorage: "up", providers: "up" } })).toBe(true);
    expect(validateHealthPayload("/api/health/ready", 200, { status: "ready", dependencies: { postgresql: "up", valkey: "down" } })).toBe(false);
    expect(validateHealthPayload("/api/health/ready", 503, { status: "unavailable", dependencies: { postgresql: "up", valkey: "down" } })).toBe(false);
  });
});

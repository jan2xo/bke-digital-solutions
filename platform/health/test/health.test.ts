import { describe, expect, it, vi } from "vitest";
import {
  createCoreReadinessChecker,
  createReadinessChecker,
  liveness,
  withinHealthTimeout,
} from "../index";
import type { ReadinessFailureEvent } from "../index";

describe("V2 platform health", () => {
  it("keeps liveness shallow and dependency-free", () => {
    expect(liveness()).toEqual({ status: "alive" });
  });

  it("preserves the four V1 readiness dependency names and reports ready only when all are up", async () => {
    const postgresql = vi.fn(async () => 1);
    const valkey = vi.fn(async () => "PONG");
    const objectStorage = vi.fn(async () => true);
    const providers = vi.fn(async () => undefined);
    const readiness = createCoreReadinessChecker({
      dependencies: { postgresql, valkey, objectStorage, providers },
    });

    await expect(readiness()).resolves.toEqual({
      ready: true,
      checks: {
        postgresql: "up",
        valkey: "up",
        objectStorage: "up",
        providers: "up",
      },
    });
    expect(postgresql).toHaveBeenCalledOnce();
    expect(valkey).toHaveBeenCalledOnce();
    expect(objectStorage).toHaveBeenCalledOnce();
    expect(providers).toHaveBeenCalledOnce();
  });

  it("fails only the broken dependency and emits safe correlation metadata", async () => {
    const events: ReadinessFailureEvent[] = [];
    const readiness = createCoreReadinessChecker({
      dependencies: {
        postgresql: async () => 1,
        valkey: async () => {
          throw new Error("sensitive-internal-provider-detail");
        },
        objectStorage: async () => true,
        providers: async () => undefined,
      },
      events: { emit: (event) => void events.push(event) },
    });

    await expect(readiness("correlation-1")).resolves.toEqual({
      ready: false,
      checks: {
        postgresql: "up",
        valkey: "down",
        objectStorage: "up",
        providers: "up",
      },
    });
    expect(events).toEqual([
      {
        event: "readiness_dependency_failed",
        dependency: "valkey",
        errorCode: "DEPENDENCY_UNAVAILABLE",
        correlationId: "correlation-1",
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("sensitive-internal-provider-detail");
  });

  it("treats probe timeout as dependency unavailable without leaking timeout internals", async () => {
    const events: ReadinessFailureEvent[] = [];
    const readiness = createReadinessChecker({
      defaultTimeoutMs: 5,
      probes: [
        {
          name: "slow",
          check: async () => new Promise(() => undefined),
        },
      ],
      events: { emit: (event) => void events.push(event) },
    });

    await expect(readiness()).resolves.toEqual({
      ready: false,
      checks: { slow: "down" },
    });
    expect(events).toEqual([
      {
        event: "readiness_dependency_failed",
        dependency: "slow",
        errorCode: "DEPENDENCY_UNAVAILABLE",
      },
    ]);
  });

  it("supports direct timeout wrapping and per-probe timeout override", async () => {
    await expect(withinHealthTimeout(async () => "ok")).resolves.toBe("ok");

    const readiness = createReadinessChecker({
      defaultTimeoutMs: 100,
      probes: [
        {
          name: "override",
          timeoutMs: 5,
          check: async () => new Promise(() => undefined),
        },
      ],
    });
    await expect(readiness()).resolves.toEqual({
      ready: false,
      checks: { override: "down" },
    });
  });

  it("rejects duplicate or invalid probe configuration before serving readiness", () => {
    expect(() =>
      createReadinessChecker({
        probes: [
          { name: "db", check: async () => undefined },
          { name: "db", check: async () => undefined },
        ],
      }),
    ).toThrow("DUPLICATE_HEALTH_PROBE");

    expect(() =>
      createReadinessChecker({
        probes: [{ name: "", check: async () => undefined }],
      }),
    ).toThrow("INVALID_HEALTH_PROBE");

    expect(() =>
      createReadinessChecker({
        probes: [{ name: "db", timeoutMs: 0, check: async () => undefined }],
      }),
    ).toThrow("INVALID_HEALTH_PROBE");
  });
});

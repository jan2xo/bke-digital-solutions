import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Digital Solutions commissioning retirement", () => {
  it("removes software commissioning from the production scheduler", () => {
    const registry = readFileSync("lib/scheduler/registry.ts", "utf8");
    const handlers = readFileSync("lib/scheduler/handlers.ts", "utf8");

    expect(registry).not.toContain("commissioning.evidence");
    expect(registry).not.toContain("commissioningLifecycle");
    expect(handlers).not.toContain("processPendingCommissioning");
    expect(handlers).not.toContain("commissioningLifecycle");
  });

  it("removes Digital Solutions owned binary verification and commissioning implementations", () => {
    expect(existsSync("lib/artifacts/verify-stored-artifact.ts")).toBe(false);
    expect(existsSync("lib/commissioning/service.ts")).toBe(false);
  });
});

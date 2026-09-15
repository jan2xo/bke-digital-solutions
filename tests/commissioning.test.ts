import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Digital Solutions commissioning retirement", () => {
  it("removes software commissioning from the production scheduler", () => {
    const definitions = readFileSync("v2/apps/web/scheduler/job-definitions.ts", "utf8");
    const handlers = readFileSync("v2/apps/web/scheduler/handlers.ts", "utf8");

    expect(definitions).not.toContain("commissioning.evidence");
    expect(definitions).not.toContain("commissioningLifecycle");
    expect(handlers).not.toContain("processPendingCommissioning");
    expect(handlers).not.toContain("commissioningLifecycle");
  });

  it("removes Digital Solutions owned binary verification and commissioning implementations", () => {
    expect(existsSync("lib/artifacts/verify-stored-artifact.ts")).toBe(false);
    expect(existsSync("lib/commissioning/service.ts")).toBe(false);
  });
});

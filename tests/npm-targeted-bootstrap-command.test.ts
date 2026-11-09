import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("targeted Staging database bootstrap test command", () => {
  it("keeps npm test arguments scoped to Vitest, not a chained command", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.test).toBe("vitest run");
    expect(pkg.scripts.posttest).toContain("node --test");
    expect(pkg.scripts.posttest).toContain("scripts/prepare-live-paymongo.test.mjs");
    expect(pkg.scripts.posttest).toContain("scripts/probe-staging-paymongo.test.mjs");
    expect(pkg.scripts.test).not.toContain("&&");
  });
  it("preserves the targeted, pre-seed Staging legal bootstrap selector", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).toContain("npm test -- tests/integration/staging-legal-bootstrap.test.ts");
    expect(workflow).toContain("Verify Staging legal initialization against disposable PostgreSQL");
  });
});

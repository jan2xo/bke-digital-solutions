import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

describe("PR-scoped comment certification bootstrap", () => {
  it("exercises a branch-provided test without requiring main to carry it", () => {
    const dispatcher = readFileSync(".github/workflows/certify.yml", "utf8");
    const core = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(dispatcher).toContain("issue_comment:");
    expect(dispatcher).toContain("PR #${{ needs.plan.outputs.pr_number }}");
    expect(dispatcher).toContain("path: manifestFile, ref: sourceSha");
    expect(dispatcher).toContain("run: node scripts/ci/pr-certification.mjs");
    expect(core).not.toContain("id-token: write");
    expect(core).not.toContain("  staging-deploy:");
    expect(existsSync(".github/workflows/stage.yml")).toBe(false);
    expect(existsSync(".github/legacy-workflows/2026-11-09/stage.yml")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validatePrPlan, readPrPlan } from "../scripts/ci/pr-certification.mjs";

const core = readFileSync(".github/workflows/ci.yml", "utf8");
const certify = readFileSync(".github/workflows/certify.yml", "utf8");
const example = { schemaVersion: 1, pr: 297, intent: "PR branch-owned focused certification test",
  requiredTargets: ["pr", "core"], testFiles: ["tests/pr-scoped-certification.test.ts"] };

describe("PR-owned intentional certification", () => {
  it("allows a PR to author its own exact-head test selection", () => {
    const plan = readPrPlan(297);
    expect(plan.requiredTargets).toEqual(["pr", "core"]);
    expect(plan.testFiles).toContain("tests/pr-scoped-certification.test.ts");
  });
  it("rejects attempts to run files outside the tests boundary or missing tests", () => {
    for (const file of ["../outside.test.ts", "scripts/payments.mjs", "tests/../unsafe.test.ts", "tests/missing.test.ts"]) {
      expect(() => validatePrPlan({ ...example, testFiles: [file] }, 297,
        (x: string) => x !== "tests/missing.test.ts")).toThrow("PR_CERTIFICATION_INVALID_TESTS");
    }
  });
  it("rejects the wrong PR, duplicate targets, or an undeclared graph", () => {
    for (const changed of [
      { pr: 296 }, { requiredTargets: ["pr", "pr"] },
      { requiredTargets: ["pr", "dangerous"] }, { requiredTargets: ["core"] },
    ]) {
      expect(() => validatePrPlan({ ...example, ...changed }, 297, () => true)).toThrow();
    }
  });
  it("keeps comment-triggered PR certification and main-only dispatcher authorization", () => {
    expect(certify).toContain("issue_comment:");
    expect(certify).toContain('"pr",');
    expect(certify).toContain('path: manifestFile, ref: sourceSha');
    expect(certify).toContain('plan.requiredTargets');
    expect(certify).toContain("activePr.head.repo?.full_name");
    expect(certify).toContain("PR #${{ needs.plan.outputs.pr_number }}");
    expect(certify).toContain("persist-credentials: false");
    expect(certify).toContain("run: node scripts/ci/pr-certification.mjs");
    expect(certify).toContain("required-certification:");
    expect(core).not.toContain("id-token: write");
  });
});

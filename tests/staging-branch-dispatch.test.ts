import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const archived = ".github/legacy-workflows/2026-11-09/stage.yml";

describe("retired PR #266 Staging dispatcher", () => {
  it("preserves its historical guards as non-executable evidence", () => {
    expect(existsSync(archived)).toBe(true);
    const source = readFileSync(archived, "utf8");
    expect(source).toContain('const targetPr = 266');
    expect(source).toContain('context.actor !== context.repo.owner');
    expect(source).toContain('currentMain.data.object.sha !== workflowSha');
    expect(source).toContain('pr.head.sha !== sourceSha');
    expect(source).toContain('workflow_id: "ci.yml"');
  });
  it("cannot be invoked as an active GitHub Actions workflow", () => {
    expect(existsSync(".github/workflows/stage.yml")).toBe(false);
    expect(existsSync(".github/workflows/ci-staging.yml")).toBe(false);
  });
});

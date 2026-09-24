import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowsDir = ".github/workflows";

describe("intent-driven pull-request certification", () => {
  it("keeps exactly one automatic pull_request owner", () => {
    const workflowNames = readdirSync(workflowsDir).filter((name) =>
      name.endsWith(".yml"),
    );
    const owners = workflowNames.filter((name) =>
      /^\s*pull_request:\s*$/m.test(
        readFileSync(`${workflowsDir}/${name}`, "utf8"),
      ),
    );

    expect(owners).toEqual(["pr-guard.yml"]);
  });

  it("passes the durable CI ownership checker", () => {
    const result = spawnSync(
      process.execPath,
      ["tooling/check-ci-intent-ownership.mjs"],
      { encoding: "utf8" },
    );

    expect(
      result.status,
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    ).toBe(0);
  });

  it("keeps the automatic PR guard lightweight", () => {
    const guard = readFileSync(
      `${workflowsDir}/pr-guard.yml`,
      "utf8",
    );

    expect(guard).toContain("Verify certification plan declaration");
    expect(guard).toContain("Verify exact PR head checkout");
    expect(guard).toContain("git diff --check");
    expect(guard).toContain("check-ci-intent-ownership.mjs");
    expect(guard).toContain("check-module-boundaries.mjs");
    expect(guard).not.toContain("npm ci");
    expect(guard).not.toContain("services:");
  });

  it("keeps substantial certification manual/reusable", () => {
    for (const name of [
      "ci.yml",
      "v2-agent-store.yml",
      "v2-commerce.yml",
      "v2-licensing.yml",
      "v2-platform.yml",
      "v2-standalone.yml",
    ]) {
      const workflow = readFileSync(
        `${workflowsDir}/${name}`,
        "utf8",
      );

      expect(workflow).toContain("workflow_dispatch:");
      expect(workflow).toContain("source_sha:");
      expect(workflow).not.toMatch(/^\s*pull_request:\s*$/m);
    }
  });

  it("keeps core CI as main verification plus explicit certification", () => {
    const workflow = readFileSync(`${workflowsDir}/ci.yml`, "utf8");

    expect(workflow).toContain("push:\n    branches: [main]");
    expect(workflow).toContain("workflow_call:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s*pull_request:\s*$/m);
  });
});

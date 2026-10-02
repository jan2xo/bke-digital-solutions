import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowsDir = ".github/workflows";
const legacyDir = ".github/legacy-workflows/2026-10-02";

function activeWorkflowNames() {
  return readdirSync(workflowsDir).filter((name) => name.endsWith(".yml"));
}

describe("intent-driven certification orchestration", () => {
  it("keeps zero automatic pull_request or ordinary push owners", () => {
    const workflowNames = activeWorkflowNames();
    const pullRequestOwners = workflowNames.filter((name) =>
      /^\s*pull_request:\s*$/m.test(
        readFileSync(`${workflowsDir}/${name}`, "utf8"),
      ),
    );
    const pushOwners = workflowNames.filter((name) =>
      /^\s{2}push:\s*$/m.test(
        readFileSync(`${workflowsDir}/${name}`, "utf8"),
      ),
    );

    expect(pullRequestOwners).toEqual([]);
    expect(pushOwners).toEqual([]);
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

  it("parses every active workflow with Ruby YAML", () => {
    const result = spawnSync(
      "ruby",
      [
        "-e",
        'require "yaml"; Dir[".github/workflows/*.yml"].sort.each { |file| YAML.safe_load(File.read(file), aliases: true) }',
      ],
      { encoding: "utf8" },
    );

    expect(
      result.status,
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    ).toBe(0);
  });

  it("keeps the retired PR guard only in the inert legacy archive", () => {
    expect(activeWorkflowNames()).not.toContain("pr-guard.yml");
    const guard = readFileSync(`${legacyDir}/pr-guard.yml`, "utf8");
    expect(guard).toContain("pull_request:");
    expect(
      readFileSync(`${legacyDir}/README.md`, "utf8"),
    ).toContain("inert");
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
      expect(workflow).not.toMatch(/^\s{2}push:\s*$/m);
    }
  });

  it("keeps core CI callable without automatic main verification", () => {
    const workflow = readFileSync(`${workflowsDir}/ci.yml`, "utf8");

    expect(workflow).not.toContain("push:\n    branches: [main]");
    expect(workflow).toContain("workflow_call:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s*pull_request:\s*$/m);
  });
});

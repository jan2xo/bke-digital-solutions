import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(".github/workflows/stage.yml", "utf8");
const marker = "      - name: Validate source and dispatch branch-owned Staging";
const pos = source.indexOf(marker);
if (pos < 0) throw new Error("Missing branch Staging dispatcher");
const after = source.slice(source.indexOf("          script: |", pos)).split("\n").slice(1);
const lines: string[] = [];
for (const line of after) {
  if (line.startsWith("            ")) lines.push(line.slice(12));
  else if (line.trim() === "") lines.push("");
  else break;
}
const script = lines.join("\n");
const runScript = new Function("github", "context", "core", "process", "return (async () => {\n" + script + "\n})();");

const SHA = "5422ee97e7be81cbe497c1ce19da98991d465914";
const MAIN = "2011df021036c8885edffda1c629a4ce489c64a5";
const BRANCH = "feat/workers-free-compatibility-proof";

function harness(options: { sourceSha?: string; mainSha?: string; branchSha?: string; actor?: string; workflowRef?: string; prBranch?: string } = {}) {
  const getRef = vi.fn(async ({ ref }: { ref: string }) => ({
    data: { object: { sha: ref === "heads/main" ? (options.mainSha ?? MAIN) : (options.branchSha ?? SHA) } },
  }));
  const get = vi.fn(async () => ({
    data: {
      state: "open", merged: false,
      base: { ref: "main" },
      head: { ref: options.prBranch ?? BRANCH, sha: options.sourceSha ?? SHA, repo: { full_name: "jan2xo/bke-digital-solutions" } },
    },
  }));
  const createWorkflowDispatch = vi.fn(async () => ({}));
  const github = { rest: { git: { getRef }, pulls: { get }, actions: { createWorkflowDispatch } } };
  const summary = { addHeading: vi.fn(), addRaw: vi.fn(), write: vi.fn(async () => {}) };
  summary.addHeading.mockReturnValue(summary);
  summary.addRaw.mockReturnValue(summary);
  const core = { info: vi.fn(), summary };
  const context = { actor: options.actor ?? "jan2xo", repo: { owner: "jan2xo", repo: "bke-digital-solutions" } };
  const process = { env: { EXPECTED_SOURCE: SHA, EXPECTED_WORKFLOW: MAIN, WORKFLOW_SHA: MAIN, WORKFLOW_REF: options.workflowRef ?? "jan2xo/bke-digital-solutions/.github/workflows/stage.yml@refs/heads/main" } };
  const execute = () => runScript(github, context, core, process) as Promise<void>;
  return { execute, getRef, get, createWorkflowDispatch };
}

describe("owner-authorized exact-head branch Staging handoff", () => {
  it("dispatches only the matching approved PR branch and exact certified source", async () => {
    const h = harness();
    await h.execute();
    expect(h.createWorkflowDispatch).toHaveBeenCalledExactlyOnceWith({
      owner: "jan2xo", repo: "bke-digital-solutions", workflow_id: "ci-staging.yml", ref: BRANCH,
      inputs: { source_sha: SHA, initialize_staging_legal: "false" },
    });
    expect(h.getRef).toHaveBeenCalledTimes(2);
    expect(h.get).toHaveBeenCalledWith({ owner: "jan2xo", repo: "bke-digital-solutions", pull_number: 266 });
  });

  it.each([
    ["nonowner caller", { actor: "untrusted" }],
    ["stale branch head", { branchSha: "a".repeat(40) }],
    ["moved main workflow", { mainSha: "b".repeat(40) }],
    ["unapproved PR branch", { prBranch: "feature/untrusted" }],
    ["untrusted workflow ref", { workflowRef: "jan2xo/bke-digital-solutions/.github/workflows/stage.yml@refs/heads/feature/untrusted" }],
    ["different PR head", { sourceSha: "c".repeat(40) }],
  ] as const)("rejects %s without dispatch", async (_label, options) => {
    const h = harness(options);
    await expect(h.execute()).rejects.toThrow();
    expect(h.createWorkflowDispatch).not.toHaveBeenCalled();
  });
});

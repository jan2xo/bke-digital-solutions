import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const workflow = readFileSync(".github/workflows/deploy-web-code-only.yml", "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as
  new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

function authorizedGuardScript() {
  const lines = workflow.split(/\r?\n/);
  const first = lines.findIndex((line) => line === "          script: |");
  const last = lines.findIndex((line) => line === "  web-code-release:");
  if (first < 0 || last <= first) throw new Error("WEB_RELEASE_SCRIPT_BOUNDARY_MISSING");
  return lines.slice(first + 1, last)
    .map((line) => line.startsWith("            ") ? line.slice(12) : line)
    .join("\n");
}

const source = "c".repeat(40);
const candidate = "b".repeat(40);
const certificateId = 42595003730;
const owner = "jan2xo";
const repo = "bke-digital-solutions";

type Options = Readonly<{
  missingJob?: string;
  claimedGraph?: readonly string[];
  declaredGraph?: readonly string[];
  commandSha?: string;
  actor?: string;
  differentTree?: boolean;
}>;

async function runGuard(
  graph: readonly string[],
  options: Options = {},
) {
  const declared = [...(options.declaredGraph ?? graph)];
  const stated = [...(options.claimedGraph ?? graph)];
  const jobs = declared.map((target) => ({
    name: target === "pr" ? "PR #308 - scoped branch certification"
      : target === "core" ? "core / Required certification"
        : target === "host" ? "host / host-v1-free"
          : target + " / " + target,
    conclusion: "success", id: 1,
  })).filter((job) => job.name !== options.missingJob);
  jobs.push({ name: "Required certification", conclusion: "success", id: 123 });
  const manifest = {
    schemaVersion: 1, pr: 308, requiredTargets: declared,
  };
  const pr = {
    number: 308,
    merged: true,
    merge_commit_sha: source,
    base: { ref: "main" },
    head: { sha: candidate, repo: { full_name: owner + "/" + repo } },
    merged_at: "2026-11-09T10:00:00Z",
  };
  const gh = {
    rest: {
      repos: {
        getBranch: vi.fn(async () => ({ data: { commit: { sha: source } } })),
        getContent: vi.fn(async () => ({ data: {
          type: "file", encoding: "base64",
          content: Buffer.from(JSON.stringify(manifest)).toString("base64"),
        } })),
      },
      pulls: { get: vi.fn(async () => ({ data: pr })) },
      actions: {
        getWorkflowRun: vi.fn(async () => ({ data: {
          event: "issue_comment", conclusion: "success",
          name: "PR #308 - Intent Certification",
          created_at: "2026-11-09T09:40:00Z",
        } })),
        listJobsForWorkflowRun: vi.fn(),
      },
      git: { getCommit: vi.fn(async ({ commit_sha }: { commit_sha: string }) => ({
        data: { tree: { sha: options.differentTree && commit_sha === candidate ? "different" : "tree-verified" } },
      })) },
    },
    paginate: vi.fn(async () => jobs),
  };
  const context = {
    repo: { owner, repo },
    ref: "refs/heads/main", sha: source,
    actor: options.actor ?? owner,
    payload: { comment: { user: { login: owner } }, issue: { number: 308 } },
    issue: { number: 308 },
  };
  const outputs = vi.fn();
  const core = { setOutput: outputs, info: vi.fn() };
  const originFetch = vi.fn(async () => ({
    ok: true,
    text: async () => "2026-11-09T09:43:30Z Required certification PASS for " +
      candidate + ": " + stated.join(", ") + "\n",
  }));
  const fixtureProcess = { env: {
    COMMENT: "/deploy-web verify " + (options.commandSha ?? source) + " " +
      certificateId + " READ_ONLY",
    GITHUB_AUTH_TOKEN: "fake-test-token",
  } };
  const fn = new AsyncFunction(
    "github", "context", "core", "fetch", "process", "AbortSignal", "Buffer",
    authorizedGuardScript(),
  );
  await fn(gh, context, core, originFetch, fixtureProcess, AbortSignal, Buffer);
  return { outputs, gh, originFetch };
}

describe("protected release exact-head certification graph", () => {
  it("preserves explicit owner, exact current main, immutable PR tree, and Production gate", () => {
    expect(workflow).toContain("context.actor !== owner");
    expect(workflow).toContain("pr.merge_commit_sha !== source");
    expect(workflow).toContain("candidate.data.tree.sha !== merged.data.tree.sha");
    expect(workflow).toContain("ref: pr.head.sha");
    expect(workflow).toContain("name: Production");
    expect(workflow).toContain("wrangler deploy --config .wrangler-web-production.json --keep-vars");
    expect(workflow).not.toContain("npm run db:deploy");
  });

  const graphCases: [string, readonly string[]][] = [
    ["legacy web graph", ["pr", "core", "host"]],
    ["web + Accounts graph", ["pr", "core", "accounts", "host"]],
    ["web + Payments graph", ["pr", "core", "payments", "host"]],
    ["release Platform graph", ["pr", "core", "platform", "host"]],
    ["web + Notifications graph", ["pr", "core", "notifications", "host"]],
  ];
  it.each(graphCases)("accepts %s only with each declared exact-head job and log proof", async (_label, graph) => {
    const { outputs, gh } = await runGuard(graph);
    expect(outputs).toHaveBeenCalledWith("allowed", "true");
    expect(gh.rest.repos.getContent).toHaveBeenCalledWith({
      owner, repo, path: ".github/pr-certification/pr-308.json", ref: candidate,
    });
  });

  it("refuses a green aggregate if an explicitly required Payments module is absent", async () => {
    await expect(runGuard(["pr", "core", "payments", "host"], {
      missingJob: "payments / payments",
    })).rejects.toThrow("WEB_RELEASE_REQUIRED_PROOF_MISSING");
  });

  it("refuses a misleading three-target aggregate for a four-target certification plan", async () => {
    await expect(runGuard(["pr", "core", "payments", "host"], {
      claimedGraph: ["pr", "core", "host"],
    })).rejects.toThrow("WEB_RELEASE_AGGREGATE_NOT_EXACT_CANDIDATE");
  });

  it("refuses a changed or underdeclared production certification graph", async () => {
    await expect(runGuard(["pr", "core", "payments", "host"], {
      declaredGraph: ["pr", "payments", "host"],
    })).rejects.toThrow("WEB_RELEASE_INVALID_CERTIFICATION_PLAN");
  });

  it("rejects a different main SHA, unapproved actor or a tree mismatch", async () => {
    await expect(runGuard(["pr", "core", "host"], {
      commandSha: "d".repeat(40),
    })).rejects.toThrow("WEB_RELEASE_NOT_OWNER_CURRENT_MAIN");
    await expect(runGuard(["pr", "core", "host"], {
      actor: "somebody-else",
    })).rejects.toThrow("WEB_RELEASE_NOT_OWNER_CURRENT_MAIN");
    await expect(runGuard(["pr", "core", "host"], {
      differentTree: true,
    })).rejects.toThrow("WEB_RELEASE_CERTIFIED_TREE_MISMATCH");
  });
});

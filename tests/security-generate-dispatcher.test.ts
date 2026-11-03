import { describe, expect, it } from "vitest";

type Permission = "OWNER" | "MEMBER" | "COLLABORATOR" | "NONE";
type RunStatus = "queued" | "in_progress" | "completed";
type JobConclusion = "success" | "failure" | "skipped" | null;

interface Fixture {
  association: Permission;
  login: string;
  repository: string;
  issueNumber: number;
  isPullRequest: boolean;
  prState: "open" | "closed";
  baseRef: string;
  headRef: string;
  headRepository: string;
  prSha: string;
  branchSha: string;
  permissionLevel: "admin" | "maintain" | "write" | "read" | "none";
  runs: Array<{
    id: number;
    sha: string;
    status: RunStatus;
    conclusion: "success" | "failure" | null;
    generator: JobConclusion;
    artifact?: { id: number; name: string; sha: string; runId: number; expired: boolean };
  }>;
  competingDispatches: number;
  newRunHasGenerator: boolean;
  newRunGeneratorConclusion: JobConclusion;
}

interface Decision {
  kind: "reject" | "dispatch" | "reuse" | "accepted-unconfirmed" | "observed";
  reason: string;
  runId?: number;
  artifactId?: number;
  sourceSha?: string;
}

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

const valid = (): Fixture => ({
  association: "OWNER",
  login: "jan2xo",
  repository: "jan2xo/bke-digital-solutions",
  issueNumber: 269,
  isPullRequest: true,
  prState: "open",
  baseRef: "main",
  headRef: "fix/v3-production-dependency-security",
  headRepository: "jan2xo/bke-digital-solutions",
  prSha: SHA_A,
  branchSha: SHA_A,
  permissionLevel: "admin",
  runs: [],
  competingDispatches: 0,
  newRunHasGenerator: true,
  newRunGeneratorConclusion: null,
});

function authorize(f: Fixture): Decision | null {
  const associationAllowed = ["OWNER", "MEMBER", "COLLABORATOR"].includes(f.association);
  if (!associationAllowed) return { kind: "reject", reason: "author association denied" };
  if (f.association === "OWNER") {
    if (f.login !== "jan2xo") return { kind: "reject", reason: "owner login mismatch" };
  } else if (!["admin", "maintain", "write"].includes(f.permissionLevel)) {
    return { kind: "reject", reason: "repository write permission missing" };
  }
  if (f.repository !== "jan2xo/bke-digital-solutions" ||
      f.issueNumber !== 269 ||
      !f.isPullRequest ||
      f.prState !== "open" ||
      f.baseRef !== "main" ||
      f.headRef !== "fix/v3-production-dependency-security" ||
      f.headRepository !== "jan2xo/bke-digital-solutions") {
    return { kind: "reject", reason: "PR identity or branch allowlist mismatch" };
  }
  if (!/^[0-9a-f]{40}$/.test(f.prSha) || f.prSha !== f.branchSha) {
    return { kind: "reject", reason: "stale or invalid head SHA" };
  }
  return null;
}

function decide(f: Fixture): Decision {
  const denied = authorize(f);
  if (denied) return denied;

  for (const run of f.runs) {
    if (run.sha !== f.prSha) continue;
    if (run.status === "queued" || run.status === "in_progress") {
      if (run.generator == null) {
        return { kind: "reject", reason: "same-head run active; job visibility unresolved", runId: run.id, sourceSha: f.prSha };
      }
      if (run.generator === "success") {
        const artifact = run.artifact;
        if (artifact &&
            artifact.name === `bke-production-dependency-repair-${f.prSha}` &&
            artifact.sha === f.prSha &&
            artifact.runId === run.id &&
            !artifact.expired) {
          return { kind: "reuse", reason: "generator job success and artifact verified independently of workflow conclusion", runId: run.id, artifactId: artifact.id, sourceSha: f.prSha };
        }
        return { kind: "reject", reason: "generator succeeded but exact-run artifact is not yet visible", runId: run.id, sourceSha: f.prSha };
      }
    }
    if (run.generator === "success") {
      const artifact = run.artifact;
      if (artifact &&
          artifact.name === `bke-production-dependency-repair-${f.prSha}` &&
          artifact.sha === f.prSha &&
          artifact.runId === run.id &&
          !artifact.expired) {
        return { kind: "reuse", reason: `generator success reused; overall workflow conclusion ${run.conclusion} is not a predicate`, runId: run.id, artifactId: artifact.id, sourceSha: f.prSha };
      }
    }
  }

  if (f.competingDispatches > 0) {
    return { kind: "reject", reason: "competing dispatch detected in the serialized dispatch window", sourceSha: f.prSha };
  }
  if (!f.newRunHasGenerator || f.newRunGeneratorConclusion === "skipped") {
    return { kind: "accepted-unconfirmed", reason: "dispatch accepted but positive generator job correlation is absent", sourceSha: f.prSha };
  }
  return { kind: "observed", reason: "new exact-head run positively exposes the generator job", sourceSha: f.prSha };
}

describe("trusted security generator dispatcher decisions", () => {
  it("rejects untrusted associations and read-only collaborators", () => {
    expect(decide({ ...valid(), association: "NONE" }).kind).toBe("reject");
    expect(decide({ ...valid(), association: "COLLABORATOR", permissionLevel: "read" }).kind).toBe("reject");
    expect(decide({ ...valid(), association: "MEMBER", permissionLevel: "write" }).kind).toBe("observed");
    expect(decide({ ...valid(), association: "MEMBER", permissionLevel: "none" }).kind).toBe("reject");
  });

  it("requires the repository owner identity as well as OWNER association", () => {
    expect(decide({ ...valid(), login: "impostor" }).kind).toBe("reject");
    expect(decide({ ...valid(), association: "OWNER", login: "jan2xo" }).kind).toBe("observed");
  });

  it("rejects wrong PR identity, base, head branch, fork, and stale branch SHA", () => {
    expect(decide({ ...valid(), issueNumber: 270 }).kind).toBe("reject");
    expect(decide({ ...valid(), isPullRequest: false }).kind).toBe("reject");
    expect(decide({ ...valid(), baseRef: "release" }).kind).toBe("reject");
    expect(decide({ ...valid(), headRef: "feature/other" }).kind).toBe("reject");
    expect(decide({ ...valid(), headRepository: "attacker/fork" }).kind).toBe("reject");
    expect(decide({ ...valid(), branchSha: SHA_B }).kind).toBe("reject");
    expect(decide({ ...valid(), prSha: "bad" }).kind).toBe("reject");
  });

  it("rejects duplicate queued runs even when GitHub has not exposed jobs", () => {
    const run = { id: 71, sha: SHA_A, status: "queued" as const, conclusion: null, generator: null };
    const decision = decide({ ...valid(), runs: [run] });
    expect(decision.kind).toBe("reject");
    expect(decision.reason).toContain("visibility unresolved");
  });

  it("does not reuse an artifact until generator evidence and exact artifact provenance exist", () => {
    const noJob = { id: 72, sha: SHA_A, status: "completed" as const, conclusion: "failure" as const, generator: null };
    expect(decide({ ...valid(), runs: [noJob], newRunHasGenerator: false }).kind).toBe("accepted-unconfirmed");

    const wrongSha = {
      id: 73, sha: SHA_A, status: "completed" as const, conclusion: "failure" as const, generator: "success" as const,
      artifact: { id: 9, name: `bke-production-dependency-repair-${SHA_A}`, sha: SHA_B, runId: 73, expired: false }
    };
    expect(decide({ ...valid(), runs: [wrongSha] }).kind).not.toBe("reuse");
  });

  it("reuses exact-head artifact when unrelated CI security job failed", () => {
    const run = {
      id: 74,
      sha: SHA_A,
      status: "completed" as const,
      conclusion: "failure" as const,
      generator: "success" as const,
      artifact: {
        id: 12,
        name: `bke-production-dependency-repair-${SHA_A}`,
        sha: SHA_A,
        runId: 74,
        expired: false
      }
    };
    const decision = decide({ ...valid(), runs: [run] });
    expect(decision.kind).toBe("reuse");
    expect(decision.artifactId).toBe(12);
  });

  it("rejects competing dispatches and never attributes an ordinary CI run", () => {
    expect(decide({ ...valid(), competingDispatches: 1 }).kind).toBe("reject");
    expect(decide({ ...valid(), newRunHasGenerator: false }).kind).toBe("accepted-unconfirmed");
    expect(decide({ ...valid(), newRunHasGenerator: true, newRunGeneratorConclusion: "skipped" }).kind).toBe("accepted-unconfirmed");
    expect(decide({ ...valid(), newRunHasGenerator: true, newRunGeneratorConclusion: null }).kind).toBe("observed");
  });
});

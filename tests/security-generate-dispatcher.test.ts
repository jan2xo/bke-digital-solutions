import { describe, expect, it } from "vitest";
import {
  authorizeCommenter,
  validateTarget,
  classifyPriorRun,
  correlateGeneratorRun,
  artifactBelongsToRun,
  GENERATOR_JOB,
  HEAD_BRANCH,
  REPOSITORY,
  PULL_REQUEST,
} from "../scripts/security-generate-policy.cjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function validTarget() {
  return {
    contextRepository: REPOSITORY,
    issueNumber: PULL_REQUEST,
    isPullRequest: true,
    prState: "open",
    baseRef: "main",
    baseRepository: REPOSITORY,
    headRef: HEAD_BRANCH,
    headRepository: REPOSITORY,
    sourceSha: SHA_A,
    branchSha: SHA_A,
  };
}

function runFixture(overrides = {}) {
  return {
    id: 77,
    head_sha: SHA_A,
    head_branch: HEAD_BRANCH,
    status: "completed",
    conclusion: "failure",
    ...overrides,
  };
}

function artifactFixture(overrides = {}) {
  return {
    id: 19,
    name: `bke-production-dependency-repair-${SHA_A}`,
    expired: false,
    workflow_run: { id: 77 },
    ...overrides,
  };
}

function generatorFixture(overrides = {}) {
  return {
    name: GENERATOR_JOB,
    conclusion: "success",
    ...overrides,
  };
}

describe("trusted security generator policy", () => {
  it("rejects unauthorized associations and read-only collaborators", () => {
    expect(authorizeCommenter({ association: "NONE", login: "stranger" }).ok).toBe(false);
    expect(authorizeCommenter({ association: "FIRST_TIME_CONTRIBUTOR", login: "stranger", permission: "write" }).ok).toBe(false);
    expect(authorizeCommenter({ association: "COLLABORATOR", login: "collaborator", permission: "read" }).ok).toBe(false);
    expect(authorizeCommenter({ association: "MEMBER", login: "member", permission: "none" }).ok).toBe(false);
    expect(authorizeCommenter({ association: "MEMBER", login: "member", permission: "write" }).ok).toBe(true);
    expect(authorizeCommenter({ association: "COLLABORATOR", login: "collaborator", permission: "maintain" }).ok).toBe(true);
  });

  it("requires the canonical login together with OWNER association", () => {
    expect(authorizeCommenter({ association: "OWNER", login: "impostor" }).ok).toBe(false);
    expect(authorizeCommenter({ association: "OWNER", login: "jan2xo" }).ok).toBe(true);
  });

  it("rejects wrong repository, PR, state, base, head, fork and stale SHA", () => {
    expect(validateTarget({ ...validTarget(), contextRepository: "attacker/repo" }).ok).toBe(false);
    expect(validateTarget({ ...validTarget(), issueNumber: 270 }).ok).toBe(false);
    expect(validateTarget({ ...validTarget(), isPullRequest: false }).ok).toBe(false);
    expect(validateTarget({ ...validTarget(), prState: "closed" }).ok).toBe(false);
    expect(validateTarget({ ...validTarget(), baseRef: "release" }).ok).toBe(false);
    expect(validateTarget({ ...validTarget(), baseRepository: "attacker/fork" }).ok).toBe(false);
    expect(validateTarget({ ...validTarget(), headRef: "feature/other" }).ok).toBe(false);
    expect(validateTarget({ ...validTarget(), headRepository: "attacker/fork" }).ok).toBe(false);
    expect(validateTarget({ ...validTarget(), branchSha: SHA_B }).ok).toBe(false);
    expect(validateTarget({ ...validTarget(), sourceSha: "bad" }).ok).toBe(false);
    expect(validateTarget(validTarget()).ok).toBe(true);
  });

  it("rejects queued and running exact-head runs even before job rows appear", () => {
    for (const status of ["queued", "in_progress", "waiting", "requested"]) {
      const decision = classifyPriorRun({
        run: runFixture({ status }),
        sourceSha: SHA_A,
        generatorJob: null,
        artifact: null,
      });
      expect(decision.action).toBe("reject");
    }
    // A visible 'skipped' job does not authorize a duplicate either: the
    // reusable workflow still shares the same SHA-keyed CI cancellation group.
    expect(classifyPriorRun({
      run: runFixture({ status: "in_progress" }),
      sourceSha: SHA_A,
      generatorJob: generatorFixture({ conclusion: "skipped" }),
    }).action).toBe("reject");
  });

  it("reuses exact-run artifacts after generator success even when overall CI failed", () => {
    const decision = classifyPriorRun({
      run: runFixture({ conclusion: "failure" }),
      sourceSha: SHA_A,
      generatorJob: generatorFixture(),
      artifact: artifactFixture(),
    });
    expect(decision.action).toBe("reuse");
    expect(decision.artifactId).toBe(19);
    expect(artifactBelongsToRun(artifactFixture(), { sourceSha: SHA_A, runId: 77 })).toBe(true);
  });

  it("rejects artifact reuse if SHA, run identity, name, or expiry differs", () => {
    expect(artifactBelongsToRun(artifactFixture({
      name: `bke-production-dependency-repair-${SHA_B}`,
    }), { sourceSha: SHA_A, runId: 77 })).toBe(false);
    expect(artifactBelongsToRun(artifactFixture({
      workflow_run: { id: 78 },
    }), { sourceSha: SHA_A, runId: 77 })).toBe(false);
    expect(artifactBelongsToRun(artifactFixture({ expired: true }), {
      sourceSha: SHA_A,
      runId: 77,
    })).toBe(false);
    expect(classifyPriorRun({
      run: runFixture(),
      sourceSha: SHA_A,
      generatorJob: generatorFixture(),
      artifact: artifactFixture({ workflow_run: { id: 78 } }),
    }).action).toBe("reject");
  });

  it("does not treat missing or failed generator evidence as reusable", () => {
    expect(classifyPriorRun({
      run: runFixture(),
      sourceSha: SHA_A,
      generatorJob: null,
      artifact: artifactFixture(),
    }).action).toBe("continue");
    expect(classifyPriorRun({
      run: runFixture(),
      sourceSha: SHA_A,
      generatorJob: generatorFixture({ conclusion: "failure" }),
      artifact: artifactFixture(),
    }).action).toBe("continue");
    expect(classifyPriorRun({
      run: runFixture(),
      sourceSha: SHA_A,
      generatorJob: generatorFixture({ conclusion: "skipped" }),
      artifact: artifactFixture(),
    }).action).toBe("continue");
  });

  it("correlates only a new exact-head workflow with positive generator evidence", () => {
    const candidateRun = runFixture({ id: 91, status: "in_progress" });
    const noPrior = new Set<number>();
    expect(correlateGeneratorRun({
      candidateRun,
      priorRunIds: noPrior,
      sourceSha: SHA_A,
      generatorJob: generatorFixture({ conclusion: null }),
    })).toBe(true);

    expect(correlateGeneratorRun({
      candidateRun,
      priorRunIds: new Set([91]),
      sourceSha: SHA_A,
      generatorJob: generatorFixture({ conclusion: null }),
    })).toBe(false);
    expect(correlateGeneratorRun({
      candidateRun,
      priorRunIds: noPrior,
      sourceSha: SHA_B,
      generatorJob: generatorFixture({ conclusion: null }),
    })).toBe(false);
    expect(correlateGeneratorRun({
      candidateRun: runFixture({ id: 92, head_branch: "release" }),
      priorRunIds: noPrior,
      sourceSha: SHA_A,
      generatorJob: generatorFixture({ conclusion: null }),
    })).toBe(false);
    expect(correlateGeneratorRun({
      candidateRun,
      priorRunIds: noPrior,
      sourceSha: SHA_A,
      generatorJob: { name: "Database contracts + runtime tests", conclusion: "success" },
    })).toBe(false);
    expect(correlateGeneratorRun({
      candidateRun,
      priorRunIds: noPrior,
      sourceSha: SHA_A,
      generatorJob: generatorFixture({ conclusion: "skipped" }),
    })).toBe(false);
  });

  it("rejects a competing dispatch rather than attributing the wrong run", () => {
    const firstRunIds = new Set([101]);
    const competing = runFixture({ id: 102 });
    expect(correlateGeneratorRun({
      candidateRun: competing,
      priorRunIds: firstRunIds,
      sourceSha: SHA_A,
      generatorJob: generatorFixture({ conclusion: null }),
    })).toBe(true);
    expect(correlateGeneratorRun({
      candidateRun: runFixture({ id: 101 }),
      priorRunIds: firstRunIds,
      sourceSha: SHA_A,
      generatorJob: generatorFixture({ conclusion: null }),
    })).toBe(false);
  });
});

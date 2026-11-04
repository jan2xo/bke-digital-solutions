"use strict";

const OWNER = "jan2xo";
const REPOSITORY = "jan2xo/bke-digital-solutions";
const PULL_REQUEST = 269;
const BASE_BRANCH = "main";
const HEAD_BRANCH = "fix/v3-production-dependency-security";
const GENERATOR_JOB = "Guarded production dependency generator";
const ARTIFACT_PREFIX = "bke-production-dependency-repair-";
const ACTIVE_STATUSES = new Set(["queued", "in_progress", "waiting", "requested"]);
const ALLOWED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);

function authorizeCommenter({ association, login, permission }) {
  if (!ALLOWED_ASSOCIATIONS.has(association) || !login) {
    return { ok: false, reason: "author association denied" };
  }
  if (association === "OWNER") {
    return login === OWNER
      ? { ok: true, reason: "verified repository owner" }
      : { ok: false, reason: "OWNER association does not match repository owner login" };
  }
  return WRITE_PERMISSIONS.has(permission)
    ? { ok: true, reason: "repository write permission verified" }
    : { ok: false, reason: "repository write permission missing" };
}

function validateTarget({
  contextRepository,
  issueNumber,
  isPullRequest,
  prState,
  baseRef,
  baseRepository,
  headRef,
  headRepository,
  sourceSha,
  branchSha,
}) {
  if (contextRepository !== REPOSITORY ||
      issueNumber !== PULL_REQUEST ||
      !isPullRequest ||
      prState !== "open" ||
      baseRef !== BASE_BRANCH ||
      baseRepository !== REPOSITORY ||
      headRef !== HEAD_BRANCH ||
      headRepository !== REPOSITORY) {
    return { ok: false, reason: "PR identity, state, base, head branch, or repository is outside the fixed allowlist" };
  }
  if (!/^[0-9a-f]{40}$/.test(sourceSha || "") || sourceSha !== branchSha) {
    return { ok: false, reason: "invalid or stale exact source SHA" };
  }
  return { ok: true, reason: "fixed PR target and exact branch head verified" };
}

function expectedArtifactName(sourceSha) {
  return ARTIFACT_PREFIX + sourceSha;
}

function artifactBelongsToRun(artifact, { sourceSha, runId }) {
  return Boolean(
    artifact &&
    artifact.name === expectedArtifactName(sourceSha) &&
    !artifact.expired &&
    artifact.workflow_run?.id === runId
  );
}

function classifyPriorRun({ run, sourceSha, generatorJob, artifact }) {
  if (!run || run.head_sha !== sourceSha) return { action: "continue", reason: "different source SHA" };

  // Any same-head workflow still active can be cancelled by another CI dispatch
  // because CI concurrency is keyed by source SHA. Fail closed even if its job
  // row says skipped or has not been published yet.
  if (ACTIVE_STATUSES.has(run.status)) {
    return { action: "reject", reason: "same-head workflow is queued or running" };
  }

  // The generator's own conclusion is authoritative for artifact reuse. An
  // unrelated CI audit failure must not invalidate a successful generator job.
  if (generatorJob?.conclusion === "success") {
    if (artifactBelongsToRun(artifact, { sourceSha, runId: run.id })) {
      return { action: "reuse", reason: "generator succeeded and exact-run artifact is verified", artifactId: artifact.id };
    }
    return { action: "reject", reason: "generator succeeded but the exact-run artifact is missing, expired, or mismatched" };
  }

  return { action: "continue", reason: "no successful generator artifact exists for this terminal run" };
}

function correlateGeneratorRun({ candidateRun, priorRunIds, sourceSha, generatorJob }) {
  return Boolean(
    candidateRun &&
    !priorRunIds.has(candidateRun.id) &&
    candidateRun.head_sha === sourceSha &&
    candidateRun.head_branch === HEAD_BRANCH &&
    generatorJob?.name === GENERATOR_JOB &&
    generatorJob.conclusion !== "skipped"
  );
}

module.exports = {
  OWNER,
  REPOSITORY,
  PULL_REQUEST,
  BASE_BRANCH,
  HEAD_BRANCH,
  GENERATOR_JOB,
  authorizeCommenter,
  validateTarget,
  expectedArtifactName,
  artifactBelongsToRun,
  classifyPriorRun,
  correlateGeneratorRun,
};

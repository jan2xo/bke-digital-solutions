# Protected Staging OIDC isolation from Core CI

## BKE CERTIFICATION PLAN

Intent: Fix GitHub Actions `startup_failure` caused by calling a reusable workflow whose guarded Staging deployment demands a greater OIDC permission than the unprivileged caller permits.

Evidence: workflow run 42544648297, `certify.yml` line 137, nested `staging-deploy` job `id-token: write` denied by caller (`id-token: none`). The same validation blocked `stage.yml`'s core call even when no deployment was authorized.

Baseline main: `b7060f8b0eae50b6c4bdb093449d0d13d76f4857`.

### Implemented architecture
- `.github/workflows/ci.yml`: canonical reusable unprivileged Core certification. Original database/runtime, quality/build, security, containers, Workers proof and `Required certification` aggregator preserved. Exposes `workflow_call` and optional direct `workflow_dispatch`. **Contains no id-token permission or Staging job.**
- `.github/workflows/ci-staging.yml`: protected **explicit dispatch only** staging orchestration. Calls unchanged Core as a gate; then holds exactly one protected `Staging` deployment job with `id-token: write`, Infisical OIDC, exact source/workflow provenance, no auto-trigger, owner-designated workflow/branch identity, and existing protected Staging safeguards. No direct code/application changes.
- `.github/workflows/stage.yml`: caller still uses unprivileged `ci.yml` for proof; its separately privileged Staging handoff dispatches `ci-staging.yml` rather than attempting to escalate Core. Its owner-authorization/PR-266 guard is preserved unchanged.

### Certification graph
Required: validate YAML/workflow call permission graph; exact head Core CI at candidate branch (manual `ci.yml` dispatch with `source_sha`, no staging); ensure all Core jobs and `Required certification` succeed; prove `certify.yml` + `stage.yml` can evaluate without nested OIDC error after the trusted fix lands; verify guarded Staging workflow is dispatch-only, exact SHA and Infisical OIDC scope remains exclusive to its protected job.
Not required: actual Staging deployment, production, PayMongo/provider, application/DB migrations or Agent/Launcher CI. Cross repo: none.
External provenance: `ci.yml` remains named `CI` with the same `Required certification` job name for the existing protected live-paymongo verifier.
Production: LOCKED. No force push or deployment.
## PR-scoped CI authority and obsolete Staging retirement

Owner correction: PR-authored tests and certification plans must not be artificially constrained by the immutable main workflow. The registered default-branch comment dispatcher remains a small trusted routing and aggregation layer; a PR can own `.github/pr-certification/pr-NNN.json`, additional tests and a declared `requiredTargets` graph. The dispatcher fails closed if required graph members are missing.

PR #266 is already merged. Its old `stage.yml` only accepted PR #266 and can never perform authorized future work. The extracted `ci-staging.yml` retained the same historical branch lock; both are archived unchanged in `.github/legacy-workflows/2026-11-09/` and no longer active. No Staging deployment is claimed by this repair. Future protected Staging requires a separately reviewed workflow/intent.

Active Core `ci.yml` stays unprivileged and retains external `CI` + `Required certification` provenance. Existing narrowly owned module workflows stay callable because they represent distinct behavioral proof, not automatic full-CI events. The PR #297 minimum complete plan is `pr core`. No production, commerce or payments changes.

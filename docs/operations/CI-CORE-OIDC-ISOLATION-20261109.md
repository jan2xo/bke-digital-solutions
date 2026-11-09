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
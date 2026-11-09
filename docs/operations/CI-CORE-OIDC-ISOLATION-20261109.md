# Intentional CI: isolate OIDC staging from core certification

## BKE CERTIFICATION PLAN

Intent: Remove GitHub Actions startup_failure caused by a reusable core CI workflow requesting an OIDC scope the certification caller explicitly cannot grant.

Root cause: `.github/workflows/certify.yml` and `.github/workflows/stage.yml` call `ci.yml` from an unprivileged top-level workflow. `ci.yml` contains a guarded `staging-deploy` job with `permissions.id-token: write`. GitHub validates the full called workflow and rejects the caller even though deploy is not selected.

Baseline main: `b7060f8b0eae50b6c4bdb093449d0d13d76f4857` (reconfirm before merge).
Evidence: run 42544648297 (`Invalid workflow file`, certify.yml L137, staging-deploy id-token write vs caller id-token none).

Implementation:
- Extract the existing core testing jobs and exact-head required-certification aggregator to a reusable `ci-core.yml` that never asks for OIDC.
- Make `certify.yml` and disposable `stage.yml` call this unprivileged `ci-core.yml` instead.
- Preserve `ci.yml` as independently-dispatched entry point that calls `ci-core.yml` for proof, retains its protected `staging-deploy` step under explicit `workflow_dispatch` and `Staging` environment, and exposes a final `Required certification` job for existing external CI-run provenance consumers.
- Preserve exact-SHA, workflow identity, guard, environment, Infisical, and live payment protection; do not grant id-token to ordinary certification callers.

Required proof: Validate workflow YAML and permissions; independent exact-head `ci.yml` dispatch of the candidate branch with `deploy_staging=false`, verify core Required certification + no Staging job; verify `certify.yml` callable once this workflow change is on trusted main; check Staging dispatch provenance and live-paymongo CI verifier compatibility. No deployment, secret access or provider activity. Minimum complete graph: CI workflow proof + core. Does not require Payments, Commerce, Identity, installer, release.

Not required: staging deployment itself, protected live PayMongo workflows, application source / DB changes, cross-repo suites.
Production: LOCKED. No force push. Draft until exact-head evidence.
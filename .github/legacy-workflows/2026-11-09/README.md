# Retired PR #266 Staging workflows (2026-11-09)

These files are historical snapshots, **not executable active workflows**.

- `stage.yml`: authenticated comment/staging orchestrator hard-coded to PR #266.
- `ci-staging.yml`: extracted protected Staging OIDC workflow still pinned to PR #266's branch. This was a candidate, never certified for general deployment.

PR #266 has merged. Preserve the original contents for history, but neither file may be restored as an active Staging owner without independent authorization and exact-head security certification. The active unprivileged `ci.yml` and `certify.yml` remain supported. The separately protected Production PayMongo workflow is unchanged.

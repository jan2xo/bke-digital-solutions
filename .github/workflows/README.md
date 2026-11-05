# Active GitHub Actions

This directory contains only intentional certification workflows.

Active entrypoint:
- `certify.yml` — explicit `/certify ...` or `workflow_dispatch`
- `/certify redis` — owner-only PR #266 comment: protected Staging Upstash REST PING using **trusted main** code, no PR-source execution, no build/migration/deploy. Excluded from `/certify full`. Requires existing Infisical Staging configuration; HTTP 401 is a real failed credential check.

Reusable proof modules:
- `ci.yml` and `v2-*.yml` / `native-bke-account-handoff.yml`
- `v2-staging-redis-intent.yml` — Staging OIDC protected read-only probe, with a cheap unprivileged PR-only contract test
- invoked through `workflow_call` and/or explicit `workflow_dispatch`

There are no automatic application `pull_request` certification workflows and no ordinary branch-push certification workflows. The only targeted `pull_request` exception is the cheap **unprivileged pure Node test** in `v2-staging-redis-intent.yml` when that Redis CI contract changes; it has no Staging environment or secrets.

Historical workflows are preserved verbatim under `.github/legacy-workflows/2026-10-02/`.

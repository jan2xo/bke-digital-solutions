# Active GitHub Actions

This directory contains only intentional certification workflows.

Active entrypoint:
- `certify.yml` — explicit `/certify ...` or `workflow_dispatch`

Reusable proof modules:
- `ci.yml` and `v2-*.yml` / `native-bke-account-handoff.yml`
- invoked through `workflow_call` and/or explicit `workflow_dispatch`

There are no automatic `pull_request` certification workflows and no ordinary branch-push certification workflows.

Historical workflows are preserved verbatim under `.github/legacy-workflows/2026-10-02/`.

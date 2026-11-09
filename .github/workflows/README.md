# Active GitHub Actions

Only reusable certification owners and trusted entrypoints live here.

**Intent entry:** `certify.yml` on main, invoked explicitly by an authorized PR comment such as `/certify pr core` or `/certify identity legal`. There are no automatic heavy push or PR triggers.

**Branch-owned certification:** A PR may add or edit `.github/pr-certification/pr-NNN.json` and new tests on its own branch. The trusted dispatcher resolves the current PR head, checks the required graph, checks out that exact SHA, and runs the selected tests without deployment secrets or persisted credentials. Job names identify `PR #NNN`. The PR's independent required modules are also declared and cannot be omitted from the `/certify` request. Merge durable tests into their behavioral owner and archive temporary PR-specific recipes when the intent is completed.

**Reusable owners:** `ci.yml`, `v2-*.yml` and `native-bke-account-handoff.yml`. The aggregate `required-certification` validates declared proof only.

**Protected Production operations:** `live-paymongo-cutover.yml` is retained, independently dispatched and protected. PR branch tests never inherit its OIDC, secrets, write permissions or production approvals.

**Retired:** PR #266's hard-coded `stage.yml` and its experimental `ci-staging.yml` were archived under `.github/legacy-workflows/2026-11-09/` because PR #266 has merged. They are inert and cannot run. New Staging deployment needs a separate security-reviewed privileged intent. Older archives remain under `.github/legacy-workflows/2026-10-02/`.

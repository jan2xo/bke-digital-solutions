# Active GitHub Actions

Only reusable certification owners and trusted entrypoints live here.

**Intent entry:** `certify.yml` on main, invoked explicitly by an authorized PR comment such as `/certify pr core` or `/certify identity legal`. There are no automatic heavy push or PR triggers.

**Branch-owned certification:** A PR may add or edit `.github/pr-certification/pr-NNN.json` and new tests on its own branch. The trusted dispatcher resolves the current PR head, checks the required graph, checks out that exact SHA, and runs the selected tests without deployment secrets or persisted credentials. Job names identify `PR #NNN`. The PR's independent required modules are also declared and cannot be omitted from the `/certify` request. Merge durable tests into their behavioral owner and archive temporary PR-specific recipes when the intent is completed.

**Reusable owners:** `ci.yml`, `v2-*.yml` and `native-bke-account-handoff.yml`. The aggregate `required-certification` validates declared proof only.

**Protected PayMongo TEST probe:** `probe-paymongo-test.yml` is an owner-only explicit `/probe-paymongo-test` comment on issue #316 or exact-main `workflow_dispatch`. It is not PR CI and does not run on push. Its separate `Payments-Test` environment obtains only `test`-scope secrets via a dedicated Infisical OIDC identity (GitHub variables `INFISICAL_TEST_IDENTITY_ID`, `INFISICAL_TEST_PROJECT_ID`). It can authenticate a test secret key and create one synthetic PayMongo TEST checkout, but cannot use live keys or a database and does not verify a provider-delivered webhook. Never use the Production identity for this job.

**Protected Production operations:** `live-paymongo-cutover.yml` is retained, independently dispatched and protected. PR branch tests never inherit its OIDC, secrets, write permissions or production approvals.

**Retired:** PR #266's hard-coded `stage.yml` and its experimental `ci-staging.yml` were archived under `.github/legacy-workflows/2026-11-09/` because PR #266 has merged. They are inert and cannot run. New Staging deployment needs a separate security-reviewed privileged intent. Older archives remain under `.github/legacy-workflows/2026-10-02/`.

## Protected website release (after exact-head approval)

`deploy-web-code-only.yml` is a trusted default-branch **comment-only** route, not a CI owner or an automatic PR/push trigger. It accepts an explicit owner `/deploy-web verify` or `/deploy-web deploy` command on the **merged deployment ledger PR** only after validating current `main`, the immutable source tree and the required exact-head `pr core host` aggregate. The Production GitHub environment gates Cloudflare access. Only the existing Worker code may be updated; secrets, the current domain, production Neon, signing and provider configuration must not be mutated. This release route does **not** replace any behavior-owned certification workflow. See `docs/operations/CLOUDFLARE-WEB-CODE-RELEASE-20261109.md`.

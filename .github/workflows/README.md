# Active GitHub Actions

Only reusable certification owners and trusted entrypoints live here.

**Intent entry:** `certify.yml` on main, invoked explicitly by an authorized PR comment such as `/certify pr core` or `/certify identity legal`. There are no automatic heavy push or PR triggers.

**Branch-owned certification:** A PR may add or edit `.github/pr-certification/pr-NNN.json` and new tests on its own branch. The trusted dispatcher resolves the current PR head, checks the required graph, checks out that exact SHA, and runs the selected tests without deployment secrets or persisted credentials. Job names identify `PR #NNN`. The PR's independent required modules are also declared and cannot be omitted from the `/certify` request. Merge durable tests into their behavioral owner and archive temporary PR-specific recipes when the intent is completed.

**Reusable owners:** `ci.yml`, `v2-*.yml` and `native-bke-account-handoff.yml`. The aggregate `required-certification` validates declared proof only.

**Protected PayMongo TEST probe:** `probe-paymongo-test.yml` is owner-only (`/probe-paymongo-test` on issue #316, or exact-main manual dispatch), never push/PR CI. It reuses the existing protected GitHub **Production approval environment** and its already-configured Infisical OIDC identity/project only to make **two named test-secret reads** from Infisical `prod` (`PAYMONGO_TEST_MODE_SECRET_KEY` and `PAYMONGO_TEST_MODE_WEBHOOK_KEY`). No Infisical bulk secrets action is used; the isolated Node probe receives only these two values plus TEST-only flags, rejects `sk_live_`, and cannot create a BKE order/license or access Neon. This deliberately reuses the broader Production identity under the same approval boundary; it is not a separate least-privilege TEST identity. Future standalone payment acceptance should use dedicated TEST-scoped OIDC rather than extending this temporary probe. A hosted TEST checkout proves no real settlement or provider-delivered webhook.

**Protected Production operations:** `live-paymongo-cutover.yml` is retained, independently dispatched and protected. PR branch tests never inherit its OIDC, secrets, write permissions or production approvals.

**Retired:** PR #266's hard-coded `stage.yml` and its experimental `ci-staging.yml` were archived under `.github/legacy-workflows/2026-11-09/` because PR #266 has merged. They are inert and cannot run. New Staging deployment needs a separate security-reviewed privileged intent. Older archives remain under `.github/legacy-workflows/2026-10-02/`.

## Protected website release (after exact-head approval)

`deploy-web-code-only.yml` is a trusted default-branch **comment-only** route, not a CI owner or an automatic PR/push trigger. It accepts an explicit owner `/deploy-web verify` or `/deploy-web deploy` command on the **merged deployment ledger PR** only after validating current `main`, the immutable source tree and the required exact-head `pr core host` aggregate. The Production GitHub environment gates Cloudflare access. Only the existing Worker code may be updated; secrets, the current domain, production Neon, signing and provider configuration must not be mutated. This release route does **not** replace any behavior-owned certification workflow. See `docs/operations/CLOUDFLARE-WEB-CODE-RELEASE-20261109.md`.

## New independent Neon preproduction schema-only operator

`preproduction-prisma.yml` is a separately invoked **owner-only** exact-current-main operation (**manual `workflow_dispatch` only**); it is NOT part of PR or ordinary feature-branch CI and must never call the archived staging deployer. It requires the dedicated GitHub **Preproduction** approval environment and a separately stewarded OIDC machine identity scoped to the existing staging-only **BKE DIGITAL SOLUTIONS STAGING** Infisical project. That project's secret is currently in its **Development** environment (`dev`) at root `/`; the action explicitly requests `secret-name: DIRECT_DATABASE_URL`, with imports and recursion disabled, so only this one direct TLS PostgreSQL URL is exported. It does not read other secrets or production configuration. No Neon management API token is needed. Neither the protected identity nor the DB secret is automatically configured by repository source or the workflow itself.

The operator hard-pins independent Neon project `tiny-mouse-06099628`, root branch `br-divine-dream-a1qhc381`, direct read-write host, `bke_preproduction` and its owner role. The independently verified Neon root maps to a pinned direct read-write hostname. Runtime must verify that TLS hostname, database/role and an empty SQL root **before** the owner-confirmed initial `prisma migrate deploy` runs; Neon management control-plane re-attestation remains a separate operator read-only check. Actual Prisma status, all migration SHA-256 checksums, schema smoke and repeat deploy idempotence are required after migration. A separate `verify_only` mode cannot mutate. It does not seed, sign, deploy the website or call any payment/email provider. See `docs/licensing/PREPRODUCTION-PRISMA-OPERATOR.md`.

**Official preproduction migration proof completed 2026-11-14:** [protected run #43603233605](https://github.com/jan2xo/bke-digital-solutions/actions/runs/43603233605) succeeded against merged main `49b6c5adcae535deb5cdc707995273dc709bf581`. Independent [read-only Neon SQL checkpoint](https://github.com/jan2xo/bke-digital-solutions/issues/378#issuecomment-6878589863) confirms all 70 migrations completed, 88 public tables, zero incomplete/rolled back and no mock schemas. The formerly temporary issue-comment adapter is now retired; manual protected `workflow_dispatch` remains. Production remains locked.


### Retired one-time migration bridge

The temporary issue #378 `/preproduction-prisma apply` event route and prior bot bridge were retired after the exact-head, protected 70/70 Prisma migration and idempotence proof. The owner-only manual `workflow_dispatch` operator remains protected and supports `verify_only` and narrowly scoped `apply_official_migrations` for explicitly authorized **fresh** preproduction targets. Historical issue comments are inert; no `issue_comment`, PR or push event can invoke the operator. Do not rerun the first-time migration against the already populated schema.


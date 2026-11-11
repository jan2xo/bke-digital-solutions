# Protected Web code-only release — Pricing navigation cleanup and Explore CTA

Date (Asia/Manila): 2026-11-11
Status: PENDING exact-head certification and protected Production approval.

## Authorized intent

The owner asked to deploy after PR #335 merged. Promote **only** already-merged UI source to the existing production Cloudflare Worker. This release ledger and its PR-scoped manifest add no application runtime logic.

- Remove the obsolete Pricing navigation item from the shared desktop/mobile public header.
- Present homepage `Explore →` as an outlined button pointing to unchanged `/products`.
- Preserve `My Software`, Google sign-in, commercial catalog pricing, all other public navigation and authentication.
- Original certified UI PR: [#335](https://github.com/jan2xo/bke-digital-solutions/pull/335), candidate head `a03e990d4e65935a91b8976d964ac961f58a35fe`, exact-head [certification #42866261318](https://github.com/jan2xo/bke-digital-solutions/actions/runs/42866261318) PASS (`pr core`), merged `main=79b8e3f2db5a775b7061ab3e32ab48c912448acc`; certified candidate tree equals merged main tree.
- Immutable release-ledger base: `79b8e3f2db5a775b7061ab3e32ab48c912448acc`.
- Initial read-only Cloudflare production state: Worker `bke-digital-solutions`, account `384c6c13373eb94a2925e0d865139970`, deployment `cf5cfeb1-7f7f-4a04-9b4b-5de8c7e76627` made 2026-11-10T16:53:45Z, version `2c074370-9dfc-4bb5-b707-ba7cb2c31a2e`, 100%.

## Exact-head certification

Release PR must declare **pr + core + host**, the minimum complete protected code-only release proof:
- `pr`: scoped source/UI and certification invariants against immutable candidate head.
- `core`: disposable runtime/PostgreSQL tests, security, Next.js build, real Worker receiving, container packaging.
- `host`: required host dependency isolation and runtime ownership proof.

Not required: payments/platform/commerce/identity/entitlements/licensing/catalog/backups/Agent/Launcher and other independent certification modules because the code-only UI release makes no change to their behavior or contracts. Reuse already verified immutable dependency releases; no cross-repo update. The protected release workflow owns post-merge publication/binding preservation and rollback.

Explicitly dispatch `/certify pr core host`; require current exact candidate SHA, all declared jobs PASS, and aggregate `Required certification PASS for <head>: pr, core, host`. SHA-lock merge the ledger, reread main and compare Git trees. Prior PR certification alone is not sufficient to deploy.

## Production publication

Use **only** the existing `.github/workflows/deploy-web-code-only.yml`. A repository-owner-authored comment on the merged release PR must be exactly:

`/deploy-web deploy <exact current main SHA> <successful exact-release-certification run ID> CODE_ONLY_PRODUCTION_RELEASE`

The workflow must reverify merged PR, exact source tree, manifest, required green jobs, immutable main SHA, and actor ownership. Human GitHub Production environment approval is mandatory; never bypass it. Its code-only process snapshots current Worker/binding fingerprint, builds with disposable build keys, publishes with `wrangler deploy --keep-vars`, verifies public HTTPS readiness, homepage, login, published legal pages, binding/custom domain/Hyperdrive parity, and attempts exact-version rollback if post-publish checks fail.

## Explicit exclusions

No production Neon migration or mutation; no PayMongo charges, refunds, replays or webhook registration change; no Resend email; no secrets, credential, DNS, account/entitlement, licensing-signing, software catalog, installer or production release publication outside the existing **Worker code-only release**. Production resources are not to be recreated. Unexpected preflight drift, missing CI, wrong head, binding mismatch, failed health, unauthorized actor or absent human review is a fail-closed stop.

## Read-only acceptance and evidence

Record exact release PR head/merge SHA/CI run, old/new Cloudflare Worker version, 100% serving status, public routes and binding drift check. Verify homepage HTML contains new `Explore →` and Pricing menu is not present, while Google/My Software logic remains untouched. Keep rollback version evidence. Source deployment success does not imply a new PayMongo delivery was tested; that is separate Issue #316.

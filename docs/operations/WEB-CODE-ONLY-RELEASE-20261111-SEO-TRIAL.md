# Protected code-only Worker release — SEO discovery and exact-product trial sign-in

Date (Asia/Manila): 2026-11-11
Status: PENDING exact-head certification and protected Production approval.

## Owner authorization and complete release intent

Owner said **GO PUSH** after two fully merged intents. Promote their already-merged application source to the **existing** production Cloudflare Worker `bke-digital-solutions`. This PR is an immutable release ledger and certification plan only: no runtime source, build configuration, schema, payment, identity protocol, or secret changes.

### Included already-merged source

1. **Public SEO** — [PR #337](https://github.com/jan2xo/bke-digital-solutions/pull/337), merged source `a0c42356f7b067afdb21ac883598ae299ffaea8f`. Native Next.js `/robots.txt`, dynamic read-only `/sitemap.xml` containing only public pages and active non-archived products, canonical social/Open Graph/Twitter metadata with fixed public origin and existing preview image. PR/Core [certification #42940472869](https://github.com/jan2xo/bke-digital-solutions/actions/runs/42940472869) SUCCESS.
2. **Trial Google sign-in continuity** — [PR #338](https://github.com/jan2xo/bke-digital-solutions/pull/338), merged source `d19cac1eab6c3ddb572146bbc95eb3f8dcc9ebb5`. Anonymous 7-day trial login now returns customers to the original product page, not the `/products` index; account enrollment and legal reacceptance retain the same local `returnTo`. No automatic trial grant; existing OIDC/consent and authorization untouched. PR/Core/Identity [certification #42943661398](https://github.com/jan2xo/bke-digital-solutions/actions/runs/42943661398) SUCCESS.
3. No other product intent is included. Open draft [PR #275](https://github.com/jan2xo/bke-digital-solutions/pull/275) (Payment Intents) remains untouched.

**Immutable release-ledger base:** `d19cac1eab6c3ddb572146bbc95eb3f8dcc9ebb5` (live `main` at intent start).

## Read-only independent production preflight

Cloudflare account `384c6c13373eb94a2925e0d865139970`, existing Worker `bke-digital-solutions`, domain `https://bkedigitalsolutions.com`.
- Latest deployment ID: `be554333-f4e2-43b6-b823-b45c8e45b627`.
- Current serving Worker version: `7ca56a4d-7cdb-467b-bcd2-54a821a3d1a7`, 100% traffic.
- Previous deployment timestamp: 2026-11-11T00:09:30Z.
- New SEO/trial source **not** yet published.

## Intentional minimum complete exact-head release certification

**Required:** `pr`, `core`, `host`, `identity`.
- `pr`: branch-owned scoped release provenance, SEO/crawl/public-route/Google trial continuity invariants.
- `core`: disposable PostgreSQL/runtime, Next build, actual Workers receiving of SEO endpoints/social tags, web auth/trial regression, security and container packaging.
- `host`: protected production code-only release dependency/binding/runtime boundary check, required by release workflow.
- `identity`: sign-in returnTo crosses Google OIDC, new-user legal enrollment and legal reacceptance, so retain independent identity proof at this exact release candidate.

**Not required:** payments, commerce, catalog write, entitlement, licensing, legal-owned document/version mutation, platform persistence/release-authority change, agent, launcher, installer, cross-repo, production readiness DB change. No upstream dependency has changed for these flows. Security-sensitive auth behavior is covered by Identity rather than waking every unrelated module.

Explicitly trigger `/certify pr core host identity` on the final release PR head, require every declared target and exact-head `Required certification PASS`. A changed head invalidates earlier proof. SHA-lock squash merge and verify merged `main` SHA and candidate/merged Git tree equality.

## Protected production release

Use **only** `.github/workflows/deploy-web-code-only.yml`, never direct Wrangler or an auto-push workflow. After merge, the authenticated repository owner must issue this exact command on the merged **release PR**:

`/deploy-web deploy <exact-current-main-SHA> <this-release-pr-successful-certification-run-ID> CODE_ONLY_PRODUCTION_RELEASE`

The guard verifies exact current main, release PR provenance, candidate/merge source tree, branch manifest/required modules and exact-head aggregate. GitHub Production environment **human approval** is mandatory and must not be bypassed. Deployment snapshots the previous Worker code and bindings, publishes code with `--keep-vars`, runs public live/ready/home/login/legal health checks, verifies bindings/custom-domain/Hyperdrive parity and attempts exact-version rollback if post-deployment proof fails.

## Explicit production exclusions

NO production database schema migration/mutation; NO PayMongo charges, refunds, events/replays, webhook registration/keys; NO Resend activity; NO secret, account, DNS, catalog/release activation, entitlement/trial grant, signing or installer changes. Only the existing Worker code is authorized to change.

## Post-deployment acceptance

- GitHub protected deployment must be completed SUCCESS including new Worker upload, live/ready/public Google entry and unchanged bindings.
- Independently verify Cloudflare reports a *new* serving Worker version at 100% (not the prior version).
- Read-only public `/robots.txt` and `/sitemap.xml` should return valid content, exclude private pages, and include public canonical BKE URLs.
- Read-only HTML checks should find Open Graph/Twitter metadata and a current product's 7-day-trial login link returning to `/products/<slug>`.
- Do not invoke live Google login, create users/trials, send mail, or charge payments merely for release QA.
- Preserve exact run, versions, checks and remaining human-only acceptance in merged PR checkpoint.

# Production code-only release — PayMongo settled companion webhook

Date (Asia/Manila): 2026-11-11
Release intent: deploy the existing certified Digital Solutions main code to the existing production Cloudflare Worker **without touching any production database, PayMongo provider configuration, webhook registration, secrets, DNS, signing, customer entitlement or backups**.

## Immutable starting state

- Main before release ledger: `dbd446b4e03bf7c6de31f53400f2001e61c0242f`.
- Worker: `bke-digital-solutions`, account `384c6c13373eb94a2925e0d865139970`, `bkedigitalsolutions.com`.
- Production running Worker version `0c49f534-bbf1-4fc0-8d4c-f72be4083ee2`, deployment timestamp `2026-11-10T08:05:19Z` (read-only verified before this PR).
- PayMongo companion-event source fix [#328](https://github.com/jan2xo/bke-digital-solutions/pull/328), exact-head [CI #42820813809](https://github.com/jan2xo/bke-digital-solutions/actions/runs/42820813809); order-ID/order-number settlement-reference fix and disposable PostgreSQL regression [#329](https://github.com/jan2xo/bke-digital-solutions/pull/329), [CI #42828327141](https://github.com/jan2xo/bke-digital-solutions/actions/runs/42828327141).
- This is a release ledger: it adds **no application runtime change**. Its candidate tree must be exact-head certified and equal the new merged-main tree before any deploy.

## Observed problem

Live PayMongo `checkout_session.payment.paid` notifications have completed successfully. Six separately signed raw `payment.paid` notifications were classified FAILED; all six map to a PAID Payment, PAID Order, matching immutable settlement fact and already-processed checkout event. Five report `PAYMENT_CHECKOUT_MISMATCH`; one `PAYMENT_EVENT_REPLAY_CONFLICT`. The deployed Worker predates the certified source fix. Production WebhookEvent records remain untouched; no provider webhook replay or payment requested.

## Exact-head certification plan

This source-only release transports the already-merged commercial fix. To meet the protected code-only release trust policy, declare:

- Required: `pr` (release manifest and tests), `core` (disposable DB integration, build, Worker receiving, security and packaging), `host` (production receiver), `payments` (signed PayMongo and companion idempotency), `platform` (privileged release/binding safety).
- Not required: identity/legal (no new identity or consent changes), commerce/entitlements (no new commercial contracts; existing Core integration proves no duplicate fulfillment), backups, licensing, native-app/Launcher/Agent, installer/release publications and cross-repository CI.
- Explicit dispatch only; no heavy CI from PR push. `required-certification` aggregates this exact candidate SHA and declared graph.
- Merge only after all required proof is PASS, SHA-locked merge, verify new `main` tree equals certified candidate tree.

## Authorized deployment

Owner explicitly instructed **GO DEPLOY** in conversation, limited to existing production Worker code only. Use existing `.github/workflows/deploy-web-code-only.yml`, owner-authored `/deploy-web deploy <exact merged main SHA> <this release PR's successful exact-head certification run ID> CODE_ONLY_PRODUCTION_RELEASE` on **this merged release PR**. Production environment review is a required human gate and must not be bypassed.

The protected workflow snapshots current Cloudflare version and binding fingerprint, builds using disposable credentials, publishes with `--keep-vars`, checks health/Google entry, verifies bindings/custom domain/Hyperdrive preserved, and attempts exact-version rollback if post-publish proof fails. Never use `live-paymongo-cutover.yml deploy_live` for this code-only fix.

## Read-only acceptance after deployment

- Verify new 100% Worker version and unchanged bindings, domain, Hyperdrive and runtime `PAYMONGO_LIVEMODE=true`.
- Verify public `/api/health/live`, `/api/health/ready`, `/login` and legal pages.
- Compare production webhook aggregates read-only; historical FAILED rows are **not** evidence the new code failed, and they are not auto-cleared.
- Later separate signed provider delivery is required to certify the new live handler; do not trigger provider replays, charges or refunds under this deployment authorization.
- Issue #316 remains OPEN for real signed webhook behavior and refund-ordering proof. Backups and Google acceptance are out of scope.

**Stop/fail closed:** missing exact-head proof, unexpected main SHA, changed production binding fingerprint, failure of existing domain/Hyperdrive audit, unapproved Production environment, build/health failures, or missing rollback evidence.

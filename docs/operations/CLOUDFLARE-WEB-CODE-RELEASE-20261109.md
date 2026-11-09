# Production Cloudflare web-code-only release

**Intent:** Release the certified Sonnet storefront and unified Google identity code from the current Digital Solutions main to the existing Cloudflare Worker without changing production database, existing binding values, provider configuration, DNS, or secrets.

**Immutable baseline:** `5e48fdebced76f6b5e053c240c23fc416af7213f`. The source tree is identical to certified PR #296 exact-head tree `b9d6920aeedfabb505971086ed08fda22fe0b036`; PR #296 required graph PASS in https://github.com/jan2xo/bke-digital-solutions/actions/runs/42557779906.

**Target (live, read-only verified 2026-11-09):** Cloudflare account `384c6c13373eb94a2925e0d865139970`, Worker `bke-digital-solutions`, custom domain `bkedigitalsolutions.com`, Hyperdrive `ea1691c683e64bd0b9acc3489ab7759c` → Neon `bke_production`; query caching disabled. Neon production has all 61 repository migrations applied, no incomplete migrations, with existing business rows. Preserve all data. The current 100% Worker version is `d18fccf9-43f1-46c1-a714-69ccc57b42bc`. Revalidate before deployment.

**Safety contract:**
- Production source must be current merged main, with SHA-locked successful exact-tree PR certificate and required aggregate; no stale or partial proof.
- Deploy command must be an explicit, owner-authored release comment on that *merged release PR*. No automatic push/PR deployment.
- Production environment reviewer and least-privilege Cloudflare API token required.
- Application code-only; zero provider payments/emails, production DB migrations, signing cutover, catalog activation, or Cloudflare DNS edits.
- Preserve dashboard plain vars via Wrangler `--keep-vars`, existing secrets via Wrangler's non-destructive default, existing custom domain via `workers_dev=false` with no route reconciliation, existing Hyperdrive, service and Email bindings.
- Before update snapshot existing Worker version and binding fingerprint; after update assert bindings unchanged and readiness endpoints healthy. Attempt exact-version rollback if post-deploy readiness fails. No SQL rollback.

**Certification graph:** `pr core host` on the release workflow PR head. Dedicated tests prove owner-only explicit trigger, immutable main/tree/run checking, no automatic deployment, config materialization and failure on target drift. Core/Host prove Workers bundle, app receiving, security and build. No independent Identity/Legal rebuild: already certified on app-equivalent source tree and unchanged by release tooling. Excluded: commercial provider acceptance, Commerce, Payments, native Agent installers, cross-repository release.

**Production:** No deployment until protected exact-head proof and explicit code-only release command.
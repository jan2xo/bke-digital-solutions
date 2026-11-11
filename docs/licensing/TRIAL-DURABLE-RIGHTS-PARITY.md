# Trial-to-durable entitlement parity — Wave 1 L2 dependency

**Status:** SOURCE IMPLEMENTATION PENDING. No production or release permission.

**Owner:** Digital Solutions Trials lifecycle + Entitlements durable-right authority; parent [#340](https://github.com/jan2xo/bke-digital-solutions/issues/340). Separate [PR #341](https://github.com/jan2xo/bke-digital-solutions/pull/341) remains an unmerged/draft pre-signing policy and is not a dependency to import or merge.

**Baseline:** DS main `888202f39ac4650b522fc2ed052557cdc9ee924f`. Source currently creates a `TrialGrant`, zero-cost `Order` and `License` without an `Entitlement`. The Agent software catalog requires an ACTIVE durable `Entitlement` for visibility; the certified L2 candidate independently checks rights lineage.

**Intent:** In the SAME serialized grant transaction, issue a source-linked durable Entitlement for the exact trial's edition and account, valid through **trialEndsAt**, not optional graceEndsAt. The source reference matches the existing order-item lineage contract. Reuse the published `@bke/entitlements` durable-right grant capability and its transaction-local persistence. On trial revoke, use the existing durable Entitlements revocation capability within that same transaction, with a durable revocation reference and metadata. Preserve existing license, activation and audit changes, repeat-revoke idempotency and yearly concurrency rules.

**Required certification graph:** branch-owned PR tests, DS `core` (transaction/DB/runtime/build), `entitlements` (durable grant/revoke), `licensing` (license authority), `catalog` (Agent catalog consumer), `native-account` (Agent account authorization behavior). Trigger only with trusted `/certify pr core entitlements licensing catalog native-account` comment. Not required: payments, commerce, host, GitHub release, Agent/Launcher binaries, product, UTM, Windows installers, immutable upstream library build. Widen only on discovered shared-security changes.

**Safety constraints:** No new endpoint, production mutation, signing/policy cutover, provider traffic, migrations (unless genuinely necessary), or release. Assert account/product/edition/paid zero-cost order consistency; deny if any is inconsistent. Trial `trialEndsAt` remains the hard stop; a grace extension must not silently create additional signed execution rights.

**Known limitations:** Pre-existing trial rows without entitlement do not become entitled by this source-only change; any historical backfill would require a separate audited and authorized migration/production action. A new trial grant by itself is not an Ed25519 signed execution lease.

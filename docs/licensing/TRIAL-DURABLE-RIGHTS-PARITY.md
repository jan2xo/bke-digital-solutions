# Trial-to-durable entitlement parity — Wave 1 L2 dependency

**Status:** IMPLEMENTED, NOT YET CERTIFIED. No production or release permission.

**Owner:** Digital Solutions Trials lifecycle + Entitlements durable-right authority; parent [#340](https://github.com/jan2xo/bke-digital-solutions/issues/340). Separate [PR #341](https://github.com/jan2xo/bke-digital-solutions/pull/341) remains an unmerged/draft pre-signing policy and is not a dependency to import or merge.

**Baseline:** DS main `888202f39ac4650b522fc2ed052557cdc9ee924f`. Source currently creates a `TrialGrant`, zero-cost `Order` and `License` without an `Entitlement`. The Agent software catalog requires an ACTIVE durable `Entitlement` for visibility; the certified L2 candidate independently checks rights lineage.

**Intent:** In the SAME serialized grant transaction, issue a source-linked durable Entitlement for the exact trial's edition and account, valid through **trialEndsAt**, not optional graceEndsAt. The source reference matches the existing order-item lineage contract. Reuse the published `@bke/entitlements` durable-right grant capability and its transaction-local persistence. On trial revoke, use the existing durable Entitlements revocation capability within that same transaction, with a durable revocation reference and metadata. Preserve existing license, activation and audit changes, repeat-revoke idempotency and yearly concurrency rules.

**Required certification graph:** branch-owned PR tests, DS `core` (transaction/DB/runtime/build), `entitlements` (durable grant/revoke), `licensing` (license authority), `catalog` (Agent catalog consumer), `native-account` (Agent account authorization behavior). Trigger only with trusted `/certify pr core entitlements licensing catalog native-account` comment. Not required: payments, commerce, host, GitHub release, Agent/Launcher binaries, product, UTM, Windows installers, immutable upstream library build. Widen only on discovered shared-security changes.

**Safety constraints:** No new endpoint, production mutation, signing/policy cutover, provider traffic, migrations (unless genuinely necessary), or release. Assert account/product/edition/paid zero-cost order consistency; deny if any is inconsistent. Trial `trialEndsAt` remains the hard stop; a grace extension must not silently create additional signed execution rights.

**Known limitations:** Pre-existing trial rows without entitlement do not become entitled by this source-only change; any historical backfill would require a separate audited and authorized migration/production action. A new trial grant by itself is not an Ed25519 signed execution lease.

## Implementation and proof scope

- `apps/web/entitlements/trial-durable-right.ts` is the transaction-bound adapter for released `@bke/entitlements` durable-right grant; it rejects ambiguous grant conflicts and uses the existing DS order-revocation capability. It opens no external DB connection.
- `apps/web/trials/service.ts` writes the matching Edition-grant **after** the TrialGrant is created but before the same transaction commits. The durable right's source reference is `commerce:<trialOrderId>:<trialOrderItemId>`, matching the trial's own PAID zero-cost Order. Its grant snapshot clearly identifies `TRIAL`, not purchased perpetual access.
- `validUntil` is exactly `trialEndsAt`, even when an administrator sets a longer grace interval on the legacy License. This is intentional fail-closed new entitlement policy; no hidden offline extension.
- A trial `REVOKE` transitions durable right `ACTIVE → REVOKED` inside the **same transaction** as machine activation disabling and License revocation, retaining revocation reference, actor and reason. A prior already-revoked right remains terminal. Pre-migration trials without a durable right may still be revoked and logged; no automatic production backfill is attempted.
- `tests/integration/trials.test.ts` asserts real PostgreSQL trial source lineage, the Agent software catalog's entitlement projection, one concurrent self-service right, hard expiry across grace, and durable revocation. `tests/trial-durable-right-parity.test.ts` asserts compile-independent source boundaries. These run under the existing disposable DB/core and PR certification owners.

### Known limits

- Pre-existing `TrialGrant` records are intentionally **not backfilled**; their durable rights stay absent until a separately authorized, audited migration is devised.
- Organization membership alone does not allocate an assigned License seat. The existing catalog intentionally continues requiring a real assignment for org users. Any seat provisioning change is an independently certified account/licensing intent.
- This is entitlement source parity only, not a real signed product execution lease, real Agent TPM proof, product verification or production readiness.

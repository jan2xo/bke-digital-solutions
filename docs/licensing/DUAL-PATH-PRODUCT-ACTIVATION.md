# Dual-path product activation — account entitlement OR commercial license key

**Execution state:** SOURCE / disposable-CI only. Production schema migration, product-policy cutover, signing-key changes and installer/catalog publication remain LOCKED.

## Canonical product policy

Digital Solutions `Product.activationMode` is independent from the existing product's commercial `licenseType` and purchase/edition plan. Values are fixed:

| `activationMode` | Account session + signed product lease | Commercial license key + signed lease |
| --- | --- | --- |
| `ACCOUNT` | Allowed, after BKE account, seat, entitlement, Agent proof | Denied |
| `LICENSE_KEY` | Denied (cannot fake account/Agent session) | Allowed, after real key, license, product and device checks |
| `EITHER` | Allowed, each independently verified | Allowed, each independently verified |

**Backward compatibility:** all pre-existing products and new products without explicit activation choice get `EITHER` from the additive PostgreSQL migration, regardless of their existing `licenseType` label. No customer license keys are revoked, repurposed, hidden or invalidated by this source change. A disabled/unknown mode fails closed (CHECK constraint plus runtime validation). A published, active, versioned, purchased or already licensed product **cannot change activation mode through the admin API**, preventing silent removal of an existing route after sale. Draft new products may select their mode. The admin route locks the Product row and checks live dependent histories within the update transaction.

## Two signing/verification protocols, not interchangeable

**ACCOUNT:** BKE identity (Google is only one possible sign-in provider) and session/Agent account rights are checked by `checkAgentProductLeaseEligibilityInTransaction`. It also checks `Product.activationMode`; `LICENSE_KEY` products cannot enter the account-product JWS preparation. The immutable `@bke/licensing 0.10.0` `bke.product-lease.v1` signing contract is released and test-imported, but DS has **no authenticated real JWS issuance endpoint or atomic `ISSUED` audit** yet. A test-key JWS is not activation.

**LICENSE_KEY:** existing `/api/licenses/activate`, `/api/licenses/lease` and `/api/licenses/refresh` require the **real commercial license key**, installation, device, product version and operation-specific rules. The DS commercial signer issues a signed `bke.licensing.v3` lease payload; the Agent verifies it and enforces machine identity, expiry and local authorization. The central commercial issuance wrapper checks Product mode using the hashed key, without requiring a Google session. The refresh reuse path checks the same mode before returning cached leases; account-only keys cannot be revealed via `/api/licenses/[id]/reveal`.

**EITHER means choice of credential, not cumulative privilege.** The account JWT/JWS and commercial license key do not silently authorize each other. An account email is not a key; a key does not confer an arbitrary BKE user ID. Never synthesize accountId, userId or agentSessionId for key-only activation. Key-only still respects limits, status, entitlement, revocation, signed lease verification and eventual Agent control.

**Claim Code remains different:** gift checkout yields one unbound one-time Claim Code redeemed into the recipient's authenticated BKE account; it is not a reusable commercial activation license key and does not require sending an email during gift checkout.

## Migration / compatibility assurance

- Additive SQL: `Product.activationMode TEXT NOT NULL DEFAULT 'EITHER'`, CHECK only three exact values, no destructive operations.
- Preserves existing `licenseType` and edition/commerce policy; no V2/V3-versioned feature flag added.
- Admin POST accepts explicit product activationMode, defaults to EITHER; PATCH rejects a policy change after live/version/commerce history even if the new value is otherwise supported.
- Disposable PostgreSQL proves EITHER default, ACCOUNT and LICENSE_KEY persisted, invalid mode rejected at DB, and unaffected commercial type.
- Pure tests cover both paths, fail-closed unknown modes, immutability of live policy and key-vs-account routing; source regressions check real path wiring.
- Cross-repo Agent main at inspection `2a697fc03c96130348888f1d941fc684a210344a` already contains account JWS verifier and legacy commercial lease infrastructure. This wave does not change Agent; separately certify installed Agent/Launcher behavior when customer-facing activation mode selection is wired.

## Next independent certification intents

1. Certify **actual account JWS issuance** using secure DS-owned signer custody, trusted Agent proof, serializable transaction and atomic `ISSUED` audit, with rollback on any failure. No production signing cutover.
2. Certify Agent acceptance of both signed protocols and the correct product activation mode before runtime execution. No new standalone front-end Google requirement.
3. When product management UI is implemented, display account/key/either choices only to admins under the same immutable-after-publish guard; consumer UX must offer key entry where configured.

**Authority:** GitHub owns source/release; Digital Solutions owns identity, policy and commerce; Agent owns verified runtime enforcement; Launcher owns UX. This PR changes no production keys, production DB, PayMongo/Resend, installers or npm package publication.

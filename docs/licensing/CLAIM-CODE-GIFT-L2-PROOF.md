# BKE Claim Code gift → L2 source-eligibility fraction

**Intent:** disposable PostgreSQL proof that a gifted single-unit code purchased by account A can be redeemed atomically into account B, producing a recipient-bound durable Entitlement and License, without any right for the purchaser or account C. Real `consumeClaimCode` + real L2 `readAccountProductLeaseEvidenceInTransaction` + pure policy must accept only recipient B.

**Stacked base:** [DS #341](https://github.com/jan2xo/bke-digital-solutions/pull/341), exact source `6867b1eee0044abfbd4f5f7bfcad7fa59145e38e`, independently 6/6 certified; remains DRAFT / UNMERGED. Current main `bf2eb6429f8061fe3fe4720958d7963f2fec7e30`.

**Minimum complete certification:** `pr core commerce entitlements licensing catalog native-account`. Exact PR-head comment, no automatic heavy CI. PR scoped hermetic test; Core disposable DB owns real redemption and L2 query. Not required: external payments, providers, production host, Agent/Launcher, Windows/installer, packaged JWS or release suites.

**Security negatives:** stale/replayed code, purchaser cannot borrow recipient's rights, unrelated C cannot borrow, forged cross-account `claimedToAccountId` or source-product association must deny, expired/revoked durable rights deny. Do not authenticate the Agent session artificially: source-only L2 proof, separate session-layer certification remains from #341.

**Known quantity boundary:** `License.orderItemId` has a uniqueness constraint. Gift units 2+ sharing one order item need a separate commerce/licensing migration design and owned certification; this proof is strictly **one unit**. Do not remove or override schema constraints to get CI green.

**Locks:** no production deployment, DB mutation, payments or emails, signing cutover, installer/catalog/software publication or force push. This stacked proof stays draft until #341's upstream release/issuance dependencies are resolved.

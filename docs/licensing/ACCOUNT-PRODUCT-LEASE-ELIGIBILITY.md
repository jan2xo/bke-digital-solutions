# Digital Solutions — Account-Product Lease Eligibility (L2 pre-issuance)

**Status:** DS source-only draft integrated with merged trial-right parity; no public authorizing API and **NO JWS ISSUE OR LIVE PRODUCT ACCEPTANCE**.

**Owner:** [DS #340](https://github.com/jan2xo/bke-digital-solutions/issues/340) Wave 1; [DS PR #341](https://github.com/jan2xo/bke-digital-solutions/pull/341).

## What this fraction really proves

1. The Agent access token is authenticated **inside the same serializable transaction** as the rights query. The service obtains server-owned `sessionId`, `accountId`, `userId`; no request-supplied account/user/session IDs.
2. The existing Agent catalog must classify the product as entitled, published/installable and of a supported execution type.
3. An ACTIVE durable `Entitlement` must match the product or its edition and the account.
4. A matching ACTIVE `License` must originate from the **same purchase order item** and a source Order in PAID state, or a claimed Claim Code bound to that account/order item/product and entitlement. Expired/refunded source orders, unrelated license and unrelated entitlement cannot be combined. Subscription and TrialGrant IDs must also bind to the **same** account/product (and edition where applicable); PurchasePlan/Edition must bind to this product.
5. An INDIVIDUAL account must be owned by the authenticated user; an ORGANIZATION requires a license assignment for that user. The source customer account must be ACTIVE.
6. Trial grants must be unrevoked and within `trialStartsAt` / `trialEndsAt`; subscription rights require `status=ACTIVE` and a current billing period. Perpetual rights require an explicit PERPETUAL plan rather than a missing plan.
7. An eligibility result can expose only the **earliest limiting rights expiration**. `null` for perpetual means unlimited underlying right only; a separately governed **signed JWS maximum TTL is still mandatory**.
8. The source does not issue cryptographic authorization, change signing keys, audit issuance/denials, create a route, modify entitlement rows, or grant machine access. Those actions require a separate implementation and authorized immutable package release.

## Resolved prerequisite — newly granted trials now carry durable rights

[DS trial-entitlement PR #342](https://github.com/jan2xo/bke-digital-solutions/pull/342) merged at exact main SHA `bf2eb6429f8061fe3fe4720958d7963f2fec7e30`. Newly created seven-day trials now atomically write a durable `Entitlement` with the same `commerce:<trialOrderId>:<trialOrderItemId>` as the zero-cost PAID trial license. The hard right expires at `trialEndsAt`, regardless of any administrative License grace. Trial revocation removes the durable right within the same serializable transaction.

**This source draft has integrated that merged main SHA** and the actual SQL reader is independently tested in `tests/integration/account-product-lease-eligibility.test.ts` against disposable PostgreSQL. Positive real trial evidence is returned only when the edition, exact source order, account and Product match; trial revocation or a mismatched edition/order account rejects it. The pure policy then caps a synthetic standalone context at the actual trial expiry. **This test does not impersonate a real Agent session or prove a published installable product release.** Server-only token and live catalog checks remain mandatory in `checkAgentProductLeaseEligibilityInTransaction`.

Historical trial rows still lack durable Entitlements: no backfill was performed. Historic licenses without an explicit PERPETUAL plan still fail closed. Organization trials require a separately assigned license seat.

## Cross-repository dependencies (not promoted)

- Shared reusable `@bke/licensing` [PR #90](https://github.com/jan2xo/bke-libraries-typescript/pull/90), SHA `03dfbbae3a5e4acc95b82e323940555d85cdcf42`, certified 14 golden vectors but **UNMERGED/UNRELEASED**.
- Agent .NET independent consumer [PR #120](https://github.com/jan2xo/bke-licensing-agent/pull/120), SHA `5895f574b77e8c263cd452e6a713045b15e0ecad`, 20/20 exact-head L1 PASS; also **UNMERGED**.
- DS production package remains pinned to the existing released `@bke/licensing` artifact. **No repin to a mutable candidate branch**.

## Minimum complete certification graph

**Required for this policy-fraction intent:** DS `pr` (policy and source binding), `core` (full host TypeScript, real PostgreSQL L2 source tests, migration/runtime/build), `licensing` (license trust owner), `entitlements` (durable right), `catalog` (real Agent product visibility), and `native-account` (Agent session custody). This deliberately widens around shared authentication/authorization and entitlement boundaries.

**Not required:** DS payments/commerce/other modules, production Provider checks, Agent/Launcher binaries, UTM, packaging/installer, shared-library heavy re-certification. L1 upstream was already certified at immutable SHAs.

**Acceptance:** all required checks pass at the *same exact DS PR head*; no skipped test assertions; document SQL query limitations and no real issuance. Use normal trusted PR comment `/certify pr core licensing entitlements catalog native-account`; no PR push heavy workflows.

**Locks:** no merge while prerequisite library is still unmerged/unreleased and API route/signing/audit/expiry policy unresolved, no production deployment or DB mutation, no PayMongo/Resend activity, no signing cutover/release or force push.

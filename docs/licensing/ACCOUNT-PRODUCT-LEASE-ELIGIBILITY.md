# Digital Solutions — Account-Product Lease Eligibility (L2 pre-issuance)

**Status:** DS source-only draft, no public authorizing API and **NO JWS ISSUE OR LIVE PRODUCT ACCEPTANCE**.

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

## Important discovered source mismatch

`apps/web/trials/service.ts` currently creates `TrialGrant` and `License`, but not a durable `Entitlement` in that codepath. `readAgentSoftwareCatalog` currently requires an ACTIVE durable `Entitlement` for product entitlement. Therefore **real trial enrollment may be denied at this L2 gate** even though the pure policy correctly handles a trial backed by a matching durable right. That is a **remaining functional integration gap**, not permission to bypass the durable grant. Correct at the owning Entitlements/Trials boundary in a separate explicit certification intent.

The same caution applies to historical legacy licenses without an explicit PERPETUAL plan. This gate denies them until policy can prove the right from approved authoritative data.

## Cross-repository dependencies (not promoted)

- Shared reusable `@bke/licensing` [PR #90](https://github.com/jan2xo/bke-libraries-typescript/pull/90), SHA `03dfbbae3a5e4acc95b82e323940555d85cdcf42`, certified 14 golden vectors but **UNMERGED/UNRELEASED**.
- Agent .NET independent consumer [PR #120](https://github.com/jan2xo/bke-licensing-agent/pull/120), SHA `5895f574b77e8c263cd452e6a713045b15e0ecad`, 20/20 exact-head L1 PASS; also **UNMERGED**.
- DS production package remains pinned to the existing released `@bke/licensing` artifact. **No repin to a mutable candidate branch**.

## Minimum complete certification graph

**Required for this policy-fraction intent:** DS `pr` (the new policy decision tests), `core` (full host TypeScript, migration/runtime tests), `licensing` (license trust owner), `entitlements` (durable right), `native-account` (Agent session custody). This deliberately widens around shared authentication/authorization and entitlement boundaries.

**Not required:** DS payments/commerce/other modules, production Provider checks, Agent/Launcher binaries, UTM, packaging/installer, shared-library heavy re-certification. L1 upstream was already certified at immutable SHAs.

**Acceptance:** all required checks pass at the *same exact DS PR head*; no skipped test assertions; document SQL query limitations and no real issuance. Use normal trusted PR comment `/certify pr core licensing entitlements native-account`; no PR push heavy workflows.

**Locks:** no merge while prerequisite library is still unmerged/unreleased and API route/signing/audit/expiry policy unresolved, no production deployment or DB mutation, no PayMongo/Resend activity, no signing cutover/release or force push.

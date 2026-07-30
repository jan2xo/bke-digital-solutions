# Phase 4.2 architectural maintainability audit

Date: 2026-07-31 (Asia/Manila)

Scope: committed Phase 4.2 at `25c6b41` plus the complete current working tree. This audit did not start Phase 5, add product features, redesign interfaces, or create a commit.

## Executive assessment

The Phase 4.2 commerce design is understandable and appropriately centralized for its size. `Product → Edition → PurchasePlan` separates capabilities from commercial terms; integer pricing and annual derivation are centralized; checkout snapshots mutable catalog data; normalized provider events settle commerce transactionally; trials issue normal licenses; and download/activation paths re-check current entitlement. The modules are small and no event bus, repository layer, or speculative service split is justified now.

Three correctness gaps were fixed during this audit: cancellation is now serialized with settlement, failed webhook records are retryable without accepting changed payloads, and annual resolution independently requires a same-edition monthly source. The Phase 4.2 baseline is suitable for a focused correction commit after the verification recorded below.

The repository is not ready for Phase 5. The uncommitted permanent-customer-deletion feature intentionally destroys orders, payments, invoices, licenses, downloads, and audits, contradicting `CORE-INSTRUCTION.md` historical immutability. That separate owner-requested feature needs an explicit policy decision—prefer anonymization plus retained financial/licensing history—before it can be committed or enabled. Production infrastructure and real PayMongo/Resend certification also remain blocked.

## Domain boundary map

| Domain | Responsibility and authoritative data | Public/service boundary | Dependencies and observations |
| --- | --- | --- | --- |
| Catalog | Product metadata, publish/archive state, versions and private artifacts | Prisma-backed admin routes; `lib/product-deletion.ts` | Edition child lifecycle; some catalog mutations remain compact route logic. No circular dependency. |
| Editions | Capabilities, user/device limits and update policy | `createEdition`, `syncEditionPlans`, `editionPlanSchema` in `lib/edition-plans.ts` | Owns capabilities; depends on pricing-shape validation, not checkout. Correct boundary. |
| Pricing | Minor-unit validation, half-up rounding, annual derivation and normalized plan terms | `calculateAnnualPricing`, `resolvePurchasePlan`, `purchasePlanLabel` in `lib/pricing.ts` | Pure domain module used by catalog views and checkout. |
| Checkout | Authorized account resolution, active plan resolution, immutable order/invoice snapshot and initial provider checkout | `createCheckout` in `lib/checkout.ts` | Depends on authorization-shaped queries, pricing and payment provider. Provider call occurs after DB reservation. |
| Orders | Ownership-visible status, pending continuation and cancellation | Order routes; no dedicated order service | Continuation/cancellation business rules remain in routes. Extract only if Phase 5 adds more transitions. |
| Payments | Provider attempts, normalized events, settlement, refund and reconciliation | `PaymentProvider`, `processPaymentWebhook`, `reconcilePayment` | Clean adapter boundary. Attempt/webhook status fields are still strings. |
| Subscriptions | Customer-authorized renewal terms and period lifecycle | `issueEntitlements`, renewal and cron routes | Renewal delegates a new checkout to `createCheckout`; no unattended charge claim. |
| Trials | Annual eligibility, seven-day term, grace and revocation | `grantProductTrial`, `changeTrial` in `lib/trials.ts` | Depends on active edition, licensing primitives and audit records; transactionally cohesive. |
| Licensing | License/subscription issuance and activation entitlement | `issueEntitlements`; activation route | Issuance is reusable. Activation belongs in a service before a public SDK/API expands. |
| Downloads | Entitlement-scoped grant issuance and atomic one-time redemption | Download routes and `lib/storage.ts` | Authorization is server-side; S3 remains private. |
| Administration | RBAC-protected catalog, trial, license, customer and record operations | Server pages plus admin routes | UI is never authoritative. Some older routes audit after mutation. |
| Audit logging | Redacted operational mutation history | `audit`, `redact`, direct transactional audit creates | Transactional flows are correct; older post-mutation audit calls should be hardened before Phase 5. |

There are no circular module imports among these domains. Route handlers generally authenticate, authorize, validate, invoke a service, and construct a response. The main exceptions are pending-order continuation/cancellation, activation/download mutation, license reveal, and several older admin mutation routes. Consolidating those is warranted only when their state machines expand.

## Authoritative business rules and duplicate review

| Rule | Authoritative location | Other occurrences | Decision |
| --- | --- | --- | --- |
| Annual calculation, discount and half-up rounding | `lib/pricing.ts` | Migration backfill reproduces the integer formula; UI formats values | Migration-boundary duplication is intentional. |
| Plan shape | `editionPlanSchema`, `resolvePurchasePlan`, DB `PurchasePlan_terms_check` | Admin form presentation | Layered validation is intentional; same-edition monthly resolution was added. |
| Active product/edition/plan | `createCheckout`; `grantProductTrial` | Public pages repeat display filters | Server mutation boundaries remain authoritative. |
| Checkout resolution/snapshots | `createCheckout` | Review/catalog call pure resolver for display | Correct separation. |
| Account ownership/billing | `requireAccountAccess` exists, but checkout/order/trial repeat relational predicates | Five queries | Consolidate before Phase 5; transaction-client and return-shape differences make a rushed change risky. |
| Pending continuation/cancellation | Order routes | UI only exposes actions | Singular server rules; both paths now lock consistently. |
| Settlement/idempotency | `processPaymentWebhook` plus DB uniques | Reconciliation is read-only | Correct boundary; failed retry and payload integrity were fixed. |
| Trial year/term/grace | `lib/trials.ts`, `lib/time.ts` | UI/docs copy | Correctly centralized with DB uniqueness. |
| License validity/device cap | Activation and download routes | Both re-check because they guard different resources | Intentional defense in depth. Share before public licensing API expansion. |
| Reveal authorization | Customer/admin reveal routes | UI visibility | Independent server enforcement is correct. |
| Product deletion blockers | `evaluateProductDeletionEligibility` | UI renders returned result | Correctly centralized. |
| Same-origin | `assertSameOrigin` in every browser mutation | Repeated by design | Security-boundary repetition is intentional. |
| Audit creation | `audit` and transactional creates | Mixed post-commit/direct styles | Adopt transaction-aware use before Phase 5. |

## Complexity and service size

- `lib/product-deletion.ts` is the largest adjacent service at about 240 lines, but evaluation and ordered deletion form one safety boundary. Splitting would obscure the invariant.
- Checkout, pricing, edition-plan, licensing and trial services are each under 100 lines with clear responsibilities.
- `lib/webhooks.ts` is compact but dense. Before more events/providers, extract transition functions and type attempt/event statuses; do not split for line count alone.
- Pending continuation mixes authorization, reservation, provider communication and finalization in a route. Its two-phase structure is correct. Extract it with cancellation if Phase 5 adds reconciliation/expiry behavior.
- Activation combines lookup, enforcement, mutation and response shaping. Keep it now; move it before SDK/offline activation work.

## Transactions, concurrency and distributed limitations

| Operation | Boundary and recovery |
| --- | --- |
| Initial checkout | Order, item, invoice and `CREATING` attempt commit together. External provider success updates the attempt; failure marks it `FAILED`; continuation recovers the pending order. |
| Checkout replacement | Serializable order lock reuses a pending URL, rejects fresh creation, or reserves a replacement. Provider runs outside the transaction. Finalization locks the order before selecting `PENDING` or `CANCELLED`. |
| Cancellation | Serializable lock and authorized pending-state recheck; order, attempts and audit commit together. It cannot overwrite paid settlement. |
| Settlement/issuance | Payment, order, invoice, entitlements, event status and email outbox commit in one serializable transaction. Unique event/payment/order-item constraints prevent duplicates. Failed events retry only with the identical payload hash. |
| Late payment | Verified paid events may move `PENDING` or local `CANCELLED` to `PAID`; provider truth wins. Failure events cannot downgrade paid/refunded state. |
| Refund | `PAID → REFUNDED`; early refund is failed/retryable until paid arrives; already-refunded delivery is idempotent. |
| Trial grant | Order, license, trial and audit commit under serializable isolation; unique account/product/year plus retry mapping prevents concurrent duplicates. |
| Grace/revoke | Trial, license and audit commit together; revoked trials reject grace changes. |
| License reveal | Reveal event and first timestamp commit together; plaintext exists only in memory. |
| Product deletion | DB changes are locked/serializable, but S3 deletion cannot roll back. DB failure after S3 success can leave metadata pointing at missing objects. Use a durable deletion job/tombstone before production. |
| Download redemption | Grant consumption and counter commit before object retrieval. Storage failure consumes the grant; this is fail-closed, and the customer must request another grant. |

Provider and storage calls are unavoidable distributed transactions. Deterministic reservation and retry state—not claims of atomicity—are required.

## Effective state machines

- Order: `PENDING → PAID`, `PENDING → CANCELLED`, `CANCELLED → PAID` after verified late capture, `PAID → REFUNDED`. Partial-refund exists but is not actively transitioned. Failed payment leaves the order pending.
- Payment attempt: `CREATING → PENDING → COMPLETED`; `CREATING/PENDING → FAILED` or `CANCELLED`; stale `CREATING → FAILED` before replacement. Superseded/expired are not implemented. Free-form status is a maintainability risk.
- Subscription: issuance creates `ACTIVE`; expiration creates `EXPIRED`; refund creates `CANCELLED`; renewal creates a new pending order. `PENDING` and `PAST_DUE` currently have no transition path.
- Trial: derived `ACTIVE`, `GRACE`, `EXPIRED`, or `REVOKED` from stored dates/revocation; linked license is the access state. No redundant status column is needed.
- License: `ACTIVE`, `SUSPENDED`, `EXPIRED`, `REVOKED`; authorized admin actions can restore supported states. Trial revocation cannot be undone through trial service.

UI labels match these meanings and no unused new states were invented.

## Data model and constraints

- Product/Edition/PurchasePlan relations are explicit; historical snapshots remain independent and legacy links are nullable by design.
- Money is integer minor units with currency; annual totals are not stored.
- `PurchasePlan_terms_check` validates shape. FK alone cannot enforce MONTHLY/same-edition source; runtime now does. A validated composite/trigger constraint is recommended before Phase 5.
- Trial account/product/year and license uniqueness enforce concurrency. Null year intentionally permits multiple admin grants.
- Attempt idempotency, checkout ID, provider payment/event IDs and license order-item IDs are unique.
- Trial RESTRICT relations preserve history and block product/edition deletion.
- License ciphertext is deliberately retained for repeatable reveal; key rotation/compromise response remain blockers.
- Current indexes cover common account/status/history queries. Add attempt `(orderId, createdAt)` and webhook `(status, receivedAt)` before scale.
- The uncommitted customer hard-delete service removes protected history and conflicts with the core retention model.

## Error model

`apiError` maps core auth/origin/rate/not-found/conflict cases, but Zod and unknown domain/provider errors default to status 400 with their message. Current providers throw fixed safe codes, yet this is not a durable production contract. Before Phase 5, add typed public domain errors with explicit status/retryability and mask unknown errors as 500. Map inactive plans, duplicate trials, invalid state/grace, provider unavailable, invalid/expired/revoked license, activation cap, payment transition, deletion blockers and storage failure. Operational context belongs only in redacted logs/audits.

## Security boundaries

- Account selection, renewal, trials, order continuation/cancellation, reveal, devices and downloads independently enforce owner/member roles. Billing actions require OWNER/BILLING.
- Admin mutations require ADMIN and same-origin. UI visibility is never authorization.
- Checkout accepts only `purchasePlanId`; mutation schemas are strict; filenames and redirects are controlled.
- License plaintext is transient and never logged; ciphertext and keyed hashes serve separate purposes.
- Private grants are hashed, expiring, atomic single-use and re-check license state on redemption.
- Webhooks verify bounded raw bytes, signature/timestamp/mode, store only a hash, cross-check order facts and reject event-ID payload substitution.
- Activation/webhook endpoints correctly use protocol authentication instead of browser CSRF.
- Strong controls on customer hard deletion do not resolve its historical-retention conflict.

## Provider readiness

`PaymentProvider` isolates checkout creation, IDs/URLs, idempotency, verification/normalization and optional retrieval. Core commerce has no PayMongo shapes; UI never parses provider payloads. Mock differs only in transport/signature and deterministic local URLs. PayMongo/Resend can be certified without rewriting commerce/licensing. Remaining work is real sandbox/delivery evidence, error classification and operational events—not core redesign.

## Test architecture

Coverage exists for simultaneous plan types, annual rounding, immutable snapshots, inactive-plan rejection, continuation reuse/replacement, late capture, exact duplicate webhook, failed-webhook retry, concurrent/cross-edition trials, admin grants, grace/revoke, expired/revoked downloads, repeatable reveal, ownership denial, deletion blockers, migrations and seed behavior.

- The duplicate test previously regenerated a timestamp under one event ID; it now replays exact bytes.
- Seed slug coupling is acceptable for preservation coverage but shared fixtures would reduce setup duplication.
- Suites leave synthetic rows in the development DB. Use a disposable isolated test DB and cleanup before Phase 5 parallelism.
- Add a deterministic two-session cancellation/settlement race test before Phase 5.
- Mock cannot prove real signatures, timing, refunds or provider ordering; credential-gated sandbox tests remain required.

## Documentation alignment

Core documents correctly describe editions, simultaneous plans, derived annual price, UTC product/account/year trials, account selection, pending recovery, authoritative late payment, repeatable reveal and ciphertext retention. This audit records failed-webhook retry, completed attempts, cancellation locking, storage limitations and the customer-erasure conflict. Historical test counts remain dated evidence.

## Generated Prisma policy

Recommendation **A: continue versioning `generated/prisma`**. The generator writes outside `node_modules`, application imports target it, history consistently versions it, and generation is not guaranteed during every install/build outside CI. CI runs generation. Add `git diff --exit-code -- generated/prisma` afterward so stale generated output fails CI. Do not change policy until all install/build/deploy paths guarantee generation.

## Findings by decision class

### Fixed in this audit

- Serialized cancellation/replacement finalization with settlement.
- Retried identical stored failed webhooks and rejected event-ID payload substitution.
- Prevented failed events from downgrading paid/refunded commerce; completed successful attempts.
- Made early refunds retryable rather than silently lost.
- Enforced same-edition MONTHLY annual source in the authoritative resolver.
- Corrected duplicate replay test and added failed-event/completed-attempt coverage.

### Must resolve before committing the unrelated working tree

- Reconcile permanent customer deletion with core immutable-history policy. Prefer retained/anonymized commerce and licensing, or obtain/document a narrow legal/accounting/privacy exception. Do not combine it with Phase 4.2 corrections.

### Should fix before Phase 5

- Typed attempt/event states and constraints; DB annual-source integrity; typed safe errors; transaction-aware audits in older admin routes; durable object deletion; shared role predicates; deterministic race test; isolated integration DB; operational indexes; admin MFA/recent-auth; generated-client drift CI.

### Safe to defer

- Splitting small modules, generalized repositories, dependency injection, event buses, analytics and unused transition implementations.

### Intentional design

- Nullable legacy links plus immutable snapshots; null-year admin trials; repeatable encrypted reveal by owner direction; fail-closed grants; late capture overriding local cancellation; customer-authorized renewal.

## Recommended commit structure

Do not amend Phase 4.2. After owner review:

1. `fix(commerce): harden payment retries and cancellation concurrency`
2. `docs(architecture): record phase 4.2 maintainability audit`

Keep branding/authentication UX separate. Keep customer deletion separate only after the mandatory policy decision.

## Verification record

Final authoritative audit gate:

- `git diff --check`: passed.
- Prisma validate: passed. Migration status: seven applied and current. Drift: no difference. Idempotent seed: passed with three seed products.
- TypeScript and ESLint: passed.
- Focused pricing/payment/security: 10/10 passed.
- Focused PostgreSQL lifecycle/pending/trial: 16/16 passed; lifecycle/licensing contributed 9/9.
- Full Vitest: 48 passed, five credential-gated skips. Four real PayMongo sandbox cases and one real Resend delivery case did not run and are blocked, not passed.
- Focused commerce Playwright: 2/2 passed. Full Playwright: 5/5 passed.
- Production build: passed, 46 application pages/routes generated.
- Runtime critical audit: zero vulnerabilities.
- Secret, sensitive-log and tracked-artifact scans: passed. Documentation-only `sk_test_...` placeholders were explicitly excluded from the secret scan; no credential-shaped value was found.

Failures encountered and corrected:

1. The first focused PostgreSQL run rejected a supposed duplicate because the test regenerated `occurredAt` under the same event ID. The test now replays exact bytes; the payload-integrity guard remains.
2. The first full Vitest run selected a zero-value trial item as legacy paid commerce. The query now requires a positive legacy amount. The rerun passed 48 with five blocked skips.
3. The first focused Playwright command found port 3000 already in use. Reusing the owner's server then timed out while its external email transport was pending. An alternate `next dev` could not start because Next.js enforces one dev-server lock per worktree. The browser timeout was made transport-aware; focused and full reruns against the untouched owner server passed.
4. The first secret scan flagged documented `sk_test_...` placeholders. The corrected scan excludes only values ending in `...` and passed.

Commands genuinely executed included `sed`, `rg`, `wc`, `git status/log/diff/ls-files/check-ignore`, `lsof`, Prisma validate/status/diff, seed, TypeScript, ESLint, focused and full Vitest, focused and full Playwright, production build, runtime npm audit, and tracked artifact/secret/sensitive-log scans. No commit was created and Phase 5 was not started.

## Verdict

- **Ready to commit Phase 4.2:** the already-committed feature baseline plus the focused audit correction is maintainable and verified.
- **Ready after listed mandatory corrections:** the separate uncommitted customer-deletion work is not ready until its immutable-history conflict is resolved.
- **Not ready for Phase 5:** real PayMongo/Resend evidence and the listed production/data-integrity hardening remain blocked.

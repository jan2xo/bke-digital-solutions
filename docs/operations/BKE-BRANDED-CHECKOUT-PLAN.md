# BKE Digital Solutions — unified branded checkout plan

Plan updated 2026-11-04, Asia/Manila. This incorporates the owner's Unified Branded Checkout — PayMongo handoff into the Cloudflare migration roadmap. It records requirements and source discovery; checkout implementation and merchant runtime acceptance are pending.

## Outcome and scope

Customers select and pay for a BKE product through a responsive checkout on the BKE domain, headed **BKE DIGITAL SOLUTIONS**. Preserve **BKES INFORMATION TECHNOLOGY SOLUTIONS** in verification, settlement, tax/receipt records and disclosures wherever required. Authentic wallet, bank and 3DS screens retain their provider identities. Branding must not bypass processor authorization, fraud checks or required disclosure.

Use one existing V3 application and one payment authority across Workers and Docker. Extend the shared Payments adapter and the existing Commerce settlement path. Keep Google-only authentication in [PR267](https://github.com/jan2xo/bke-digital-solutions/pull/267) and hosting proof in [PR266](https://github.com/jan2xo/bke-digital-solutions/pull/266) separate from checkout changes. Automatic subscriptions are a conditional later slice, not a prerequisite for the hosting proof or customer-authorized renewals.

This planning addition does not authorize production charges, merchant activation, changed prices/taxes/refund policy, automatic renewals, paid infrastructure, production credentials, deployment or database cleanup. Future sandbox operations use explicitly configured test resources. Never request secret JSON in chat or commit keys.

## Verified starting point and owners

Discovery baseline: Digital Solutions default `main` at `a36d9decffa6936114a9578857558a9687ca4e7f`. Recheck GitHub before implementation, including parallel security/readiness work. The lockfile remains authoritative for exact dependency resolution.

| Responsibility | Existing owner and extension point |
|---|---|
| Principal, customer/organization access and purchase authorization | Identity and Accounts; existing Google-only browser session plus account authorization. |
| Product, edition and commercial amount | Catalog and Commerce. The current checkout route resolves the plan, pricing and legal requirements on the server. |
| Provider operations and verified payment facts | `@bke/payments` 0.9.0; composed by `apps/web/payments/provider.ts`. Extend the published capability rather than copy its policy into the host. |
| Order, invoice and fulfillment routing | `@bke/commerce` 0.15.0 and existing host orchestration. Preserve self-purchase renewal, gifts/claim codes and complimentary order behavior. |
| Durable purchased rights and runtime licensing | Entitlements owns rights; Licensing owns existing license/lease policy. Preserve the current settlement-to-licensing path and refund revocation. |
| Presentation, receipt delivery and operations | Existing `/checkout`, status/native store surfaces, Notifications and payment reconciliation/admin tooling. Verify any existing manual bank-transfer adapter before describing it as available. |

Source evidence: [checkout route](https://github.com/jan2xo/bke-digital-solutions/blob/a36d9decffa6936114a9578857558a9687ca4e7f/app/api/checkout/route.ts), [provider composition](https://github.com/jan2xo/bke-digital-solutions/blob/a36d9decffa6936114a9578857558a9687ca4e7f/apps/web/payments/provider.ts), [transactional settlement](https://github.com/jan2xo/bke-digital-solutions/blob/a36d9decffa6936114a9578857558a9687ca4e7f/apps/web/payments/settlement-transaction.ts), [webhook processing](https://github.com/jan2xo/bke-digital-solutions/blob/a36d9decffa6936114a9578857558a9687ca4e7f/apps/web/payments/webhook-processing.ts).

The composed shared adapter currently calls `/checkout_sessions`, returns `externalCheckoutId` plus a hosted URL, and is configured for `qrph` only. Its released source is [Payments 0.9.0 at `09dfe572…`](https://github.com/jan2xo/bke-libraries-typescript/blob/09dfe572c41544049e22ef8bc1a092d52c16c072/%40bke/payments/providers/paymongo/paymongo-adapter.ts). The host's settlement/ingestion records also use checkout identifiers. A Payment Intent integration therefore needs a small explicit contract and correlation change across those owners. Do not merely substitute a `pi_` identifier into a field whose consumers assume a hosted Checkout Session. Do not implement against legacy `lib/payments/paymongo.ts` while leaving the production composition unchanged.

## Payment API and method eligibility

Use server-created `POST https://api.paymongo.com/v1/payment_intents` for the custom flow. The backend owns the amount and currency; the browser creates the selected Payment Method with the public key and attaches it using the intent's client key. Treat client keys as scoped transaction credentials: deliver only to the authorized checkout, exclude them from URLs, analytics, caches and logs. Preserve authentic next-action redirects. A return URL alone never settles an order. [PayMongo Payment Intent lifecycle](https://docs.paymongo.com/docs/payment-acceptance-key-concepts).

Resolve `GET /v1/merchants/capabilities/payment_methods` server-side with the matching test/live secret, then intersect the result with implemented methods, mode, approved business configuration and transaction constraints. Unknown methods and capability failures must not enable a method optimistically. A test capability is not evidence of live approval. No merchant API was called during this planning pass. [PayMongo account capabilities](https://docs.paymongo.com/docs/account-settings-account-capabilities).

| Method | Planned identifier | Launch gate |
|---|---|---|
| QR Ph | `qrph` | Dynamic QR flow, expiry/retry and verified settlement tested; actual merchant enabled. |
| Visa / Mastercard | `card` | Same adapter, separate network logos; owner reports approval pending. Testable in sandbox, live entry remains gated. |
| GCash | `gcash` | Actual capability, redirect and receiving-path tests. |
| Maya | `paymaya` | Actual capability, redirect and receiving-path tests. |
| GrabPay | `grab_pay` | Actual capability, redirect and receiving-path tests. |
| ShopeePay | Resolve before implementation | Official wallet guide uses `shopeepay`, while the Payment Method resource reference lists `shopee_pay`. Confirm the accepted value for the chosen API with current schema/provider sandbox evidence; keep gated until resolved. |
| Manual bank transfer | Existing billing/invoicing path, if present | Separate verified operational confirmation; an uploaded screenshot cannot fulfill an order. Do not assume it is a PayMongo Payment Intent method. |

Identifier evidence: [wallet guide](https://docs.paymongo.com/docs/payment-acceptance-e-wallets), [Payment Method resource](https://docs.paymongo.com/reference/the-payment-method-object). Recheck this documented ShopeePay discrepancy rather than silently accepting either spelling.

All monetary values use validated integer minor units. The supplied Air Stack Enterprise annual invoice **PHP 85,952.69 = 8,595,269 centavos** is a reference fixture only. It does not change catalog pricing or authorize a charge. Compute discounts, quantity, fees and taxes through the current server-owned pricing policy; do not invent a tax rate, surcharge or grace period.

## One order, durable attempts, verified settlement

1. Reuse Google session, verified contact, account purchase access, legal acceptance and server-resolved product/plan checks. Record the immutable commercial/pricing/fulfillment snapshot.
2. Claim a durable checkout attempt before the provider request. Use a stable operation-specific idempotency key and request fingerprint. The provider call and PostgreSQL transaction cannot be one atomic transaction: record/finalize the provider result conditionally and reconcile uncertain outcomes before creating a replacement payable attempt.
3. Bind the provider intent/payment to the canonical attempt, order, customer account, amount, currency and mode. Expose only safe display data and authorized client operations. Do not trust a query-string intent/order ID as authority to read or fulfill another account's order.
4. Let the browser tokenize directly with PayMongo. Handle processing, authentication/redirect, decline, retry, expiry, cancellation and interrupted navigation honestly. Polling is bounded; it displays status and triggers authorized reconciliation, not entitlement issuance.
5. Verify the raw webhook, durably ingest/deduplicate it, correlate it to the attempt, verify financial facts against provider state and enter the existing serializable settlement/fulfillment path. Preserve retryable failures and recovery; do not acknowledge an event as complete before durable processing or a durable retry obligation exists.
6. Grant/renew the correct existing entitlement and licensing state once. Preserve notifications, native purchase status, gift fulfillment, refunds and revocation. Paid state cannot be downgraded by a later failed event. A duplicate payment needs an explicit operational resolution; it must not silently create a second right.

Provider idempotency keys expire after 24 hours according to the current reference. BKE's durable attempt/correlation and fulfillment invariants must outlive that window; blindly retrying an expired key can create another operation. Confirm endpoint-specific support during adapter tests. [PayMongo idempotency](https://docs.paymongo.com/reference/idempotent-requests).

Keep test/live keys and webhook endpoints separate. Verify `Paymongo-Signature` with timestamp plus the exact raw body, HMAC-SHA256, constant-time comparison and the appropriate `te` or `li` signature. Retain a bounded replay window, event deduplication, payload conflict detection and mode checks. A valid signature alone does not authorize an unrelated order or amount. [PayMongo webhook verification](https://docs.paymongo.com/docs/developer-tools-webhook-setup-management).

Reuse current durable state, job history/reconciliation and transactional owners. No new queue, database, payment microservice, artifact store or duplicate fulfillment engine is justified by this checkout requirement. Prisma remains restricted: first inspect present contracts/schema; propose only a concrete additive change needed for intent correlation, with migration replay and recovery evidence.

## UI, cards, QR and renewals

The responsive BKE checkout includes brand/logo, product/edition and license period, authoritative total/currency, approved fee/tax breakdown, customer/organization, eligible methods, instructions and accessible progress/error states. Include verified confirmation, receipt/access and a way to resume an interrupted purchase. Test desktop and mobile layouts. Use no hosted PayMongo page for normal purchase selection; required wallet/bank/3DS authorization redirects remain part of the flow.

Card details go directly from the browser to PayMongo tokenization. Never send PAN/CVV through BKE backend routes, logs, error reporting, session replay or analytics; never persist them. Test success, decline, 3DS, processing, retry and return reconciliation. Complete the appropriate PCI assessment and independent security review before live custom card entry; a sandbox card test does not establish approval or compliance. Keep card launch disabled while merchant approval is pending.

For QR Ph, show the actual provider-generated dynamic QR image, exact amount and provider expiry. The current API returns the image through `next_action.code.image_url`; QR expiry is normally 30 minutes and can be configured within provider bounds. Regeneration creates the appropriate fresh method/attempt under the documented intent lifecycle; it must not leave competing payable attempts or duplicate fulfillment. Test expired QR, delayed webhook and payment near expiry. The customer's bank outward limit may prevent a large invoice. [QR Ph API](https://docs.paymongo.com/docs/payment-acceptance-qr-ph-api), [QR Ph limits](https://docs.paymongo.com/docs/payment-acceptance-qr-ph).

Customer-authorized renewal remains independent: BKE creates a renewal invoice and the customer pays each time, including QR Ph. Monthly/annual duration does not imply permission for automatic debit. For automatic recurring billing, use PayMongo Subscriptions only after account/method enablement, explicit customer consent and approved retry, cancellation, expiry and grace policy. Current provider guidance supports cards/Maya and requires provider Card Vaulting for card subscriptions. Do not derive recurring authority from a one-time intent or store card data in BKE. [PayMongo Subscriptions](https://docs.paymongo.com/docs/payment-acceptance-subscriptions).

## Delivery sequence and checklist

| Phase | Concrete work and completion evidence | Status |
|---|---|---|
| 1. Discovery | Map current composed Payments/Commerce/Entitlements/Licensing, hosted-checkout contract and provider documentation. | Source discovery complete for this plan; merchant capabilities, sandbox response contracts and manual bank-transfer inventory pending. |
| 2. Contract + branded QR slice | Small shared Payments contract/adapter extension; BKE checkout and intent correlation; one sandbox QR purchase through existing settlement to correct entitlement. | Pending implementation. |
| 3. Cards and wallets | Eligible method discovery, client tokenization, 3DS/redirect/return paths and sandbox success/failure/retry/expiry UI. Resolve ShopeePay identifier first. | Pending; live card approval reported pending. |
| 4. Licensing and recovery | Existing renewal/gift/refund/native-status integration; concurrent/duplicate/reordered webhook and interrupted-finalization tests. | Pending. |
| 5. Conditional recurring | Provider-enabled subscriptions, explicit consent, provider token vaulting and approved lifecycle rules; customer-authorized renewal stays usable. | Deferred until prerequisites are confirmed. |
| 6. Runtime and release | Exact-head CI, independent review, desktop/mobile previews, Workers plus Docker receiving-path tests, environment template, deployment/reconciliation/rollback runbook. | Pending; no deployment or live charge. |

- [x] Owner handoff incorporated into the migration roadmap and a separate checkout workstream.
- [x] Actual shared production adapter and settlement owners inspected; identified hosted-session contract gap.
- [x] Official capability endpoint, Payment Intent flow, signature contract and conditional subscriptions checked.
- [x] Official ShopeePay identifier discrepancy recorded as a gate.
- [ ] Merchant's actual test/live capabilities verified without publishing credentials.
- [ ] Shared capability extension released and adopted as an immutable verified artifact, if needed.
- [ ] QR Ph/cards/approved wallets implemented and sandbox-certified.
- [ ] Payment-to-entitlement/licensing, refunds and native status regression-certified.
- [ ] Recurring capability, consent and business policy approved before implementation/activation.
- [ ] UI previews, environment template and target-specific operational/rollback instructions delivered.
- [ ] Independent source review, exact-head CI and both runtime targets accepted.
- [ ] Live approval/configuration and separately authorized production verification completed.

## Acceptance and release guardrails

Source certification must test amount/currency/mode/order mismatch, wrong-account access, raw-body mutation, invalid/stale signatures, duplicate/conflicting/reordered events, provider timeout, uncertain creation, concurrent retries, QR expiry, declined card, 3DS return and reconciliation recovery. No failure, screenshot or browser success screen may mint a license. Preserve free/complimentary checkout, gifts, refunds, renewal and Agent account-session behavior.

Use the repository's intentional certification mechanism. Return a compact PASS/FAIL for declared targets, exact source/workflow identity and one or two lines naming the first causal error. Do not run an actual production charge in automated certification. Keep source, sandbox/provider, actual Workers/Docker runtime, installed native and production acceptance separate; a pending capability is an honest pending gate.

Deliver checkout changes in a dedicated feature branch/PR with no unrelated Prisma or hosting cleanup. Include UI previews of success and failure, tests, non-secret environment names (including public and secret PayMongo keys with matching modes), capability/approval limitations, and deployment/reconciliation/rollback procedures. Runtime secrets are entered through the protected secret system. Retain the hosted implementation as a controlled recoverable prior artifact until replacement acceptance; never weaken existing verification to achieve the branded presentation.

For rollback, preserve in-flight Payment Intents and verified event processing even if new checkout creation is disabled. Reconcile existing payable attempts before switching flow; a code rollback cannot undo payments or entitlement writes. Do not restore an older database as routine checkout rollback. Preserve Git history and immutable package identities.

**Ownership:** BKE owns the customer experience, commercial order and licensing decision. PayMongo owns payment processing and required financial authorization. Verified provider facts cross that boundary through the shared Payments contract and existing transactional fulfillment path.

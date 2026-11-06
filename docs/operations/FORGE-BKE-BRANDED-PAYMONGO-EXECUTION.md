# FORGE — BKE Digital Solutions V3 branded PayMongo Payment Intents

Date: 2026-11-06 (Asia/Manila)
Owner-delegated implementation intent. This document establishes task/acceptance scope, not proof that implementation exists.
Repo: jan2xo/bke-digital-solutions
Delegated worker: FORGE, exclusive writer for this PR after confirming PR #269 is frozen and not an active writing assignment.
Base: current main at delegation a36d9decffa6936114a9578857558a9687ca4e7f.
Other owners: SOL owns #266 Cloudflare Workers and #267 Google-only authentication. #273/#274 retire Supply Chain/storage and preserve central licensing. #269 dependency remediation is already independently certified and frozen; do not modify it.

## Mission and immutable customer-facing requirements

Build a first-party, responsive BKE DIGITAL SOLUTIONS checkout powered by PayMongo Payment Intent APIs. Customers select payment methods, view product/order/price and QR codes, follow progress, receive confirmation and licenses on the BKE domain.

**BKE DIGITAL SOLUTIONS is the ONLY intended customer-facing checkout/brand name.** Do not surface BKES INFORMATION TECHNOLOGY SOLUTIONS as the checkout title, header, payment UI brand, product identity, confirmation brand, notification marketing brand or merchant banner. Preserve truthful legally/processor-mandated identity disclosures and private settlement/tax records; if a required provider-controlled statement, bank/wallet page, or legally mandatory disclosure cannot use BKE DIGITAL SOLUTIONS, report the concrete limitation rather than misrepresenting the merchant.

**No PayMongo hosted Checkout Session web page, generic PayMongo payment-selection website, or PayMongo UI iframe as BKE's normal checkout.** Do not use /v1 or /v2 checkout_sessions for new first-party purchases. Use POST /v1/payment_intents and client-side Payment Method creation/attachment with the scoped client key as documented by PayMongo. QR Ph code/image belongs in the BKE page. External bank/3DS/wallet authentication or app redirects are acceptable when the provider legally/security-requires them; never spoof or bypass those experiences. Treat exact provider features as capability-gated, not promised.

V3 is a fresh commercial deployment with **no V1 customer data migration**; office and other organizations are ordinary paying customers subject to normal business roles, authorization, settlement and license policy. Google OAuth/OIDC is the planned customer login. Redundant BKE customer magic-link/email-verification/MFA challenges are being retired under SOL's separate authentication decision; do not modify SOL's authentication lane or fake verified flags in the checkout. If checkout currently depends on those legacy gates, record the integration blocker and have the owner/SOL resolve it separately. Continue to require real authenticated BKE user, account purchase privileges, legal acceptance and active-account status.

## Existing application authority and no-duplicate-engine rule

- Current production-composed Payments: @bke/payments 0.9.0 through apps/web/payments/provider.ts, presently hosted QR Ph checkout_sessions. Extend the actual composed shared capability; do not patch an unused legacy payment helper as a substitute.
- Commerce: existing order, invoice, durable attempts, refunds/reconciliation and existing settlement path (@bke/commerce); retain durable transactional state.
- Entitlements and Licensing: central BKE authority to grant exact purchased right and issue/sign/manage commercial licenses and leases; client products do not issue their own licenses.
- Catalog: authoritative server-side price, product, edition, quantity, terms and fees; all monetary amounts integer minor units (PHP centavos).
- Notifications and email: receipt/status delivery remains an adjacent adapter; do not add Resend/Cloudflare Email Service activation as a payment prerequisite.
- Infrastructure: one shared application for Workers and Docker. No extra payments microservice, parallel database, new queue, separate fulfillment engine, or new always-on service.
- GitHub asset hosting: honor #273/#274 final intent and do not reintroduce software artifact/Supply Chain/S3 dependencies.
- The source plan at PR #271 is historical planning evidence, not implemented source or automatic permission to merge it.

## Required implementation path

1. **Discover exact current contracts:** inspect main, pending integrations, current composed adapter, /api/checkout, commerce settlements, webhook ingestion, invoices, gift/claim code, native purchase status, licensing issue/revoke and tests. Identify and document the precise hosted-session ID/correlation assumptions before editing.
2. **Preserve/extend capability contract:** add explicit Payment Intent + Payment Method lifecycle and attempt correlation; a pi_ intent ID must not silently replace a hosted Checkout Session ID in the wrong field. Use a versioned/immutably verified shared-library release where required. Separate cross-repo shared-library change requires its own independently delegated PR and release proof, not arbitrary commits in another repo.
3. **First complete vertical slice: QR Ph.** Create one server-authoritative order and durable attempt; create Payment Intent server-side using secret key; browser creates/attaches qrph method with public key and scoped client_key; display PayMongo-generated dynamic QR and true expiry on BKE checkout; handle pending/expired/failed/succeeded; confirm signed webhook and trusted provider facts; fulfill correct entitlement/license exactly once; prove retry/reconnect/late-webhook behavior in sandbox.
4. **Eligibility-driven method expansion:** add card, GCash, Maya, GrabPay and ShopeePay only where the exact test/live merchant capabilities and implementation support allow them. Query GET /v1/merchants/capabilities/payment_methods with the matching mode; fail closed on missing or uncertain capability. Card capture/tokenization occurs in the browser directly with PayMongo public key; no raw PAN/CVV/expiry through BKE servers, logs, analytics or database. Preserve mandatory 3DS, wallet and bank redirects. Card live launch remains disabled until merchant activation and applicable PCI review/approval. Verify exact ShopeePay type against actual API/schema before enabling it. Do not assume manual bank transfer is a Payment Intent method.
5. **State and fulfillment:** persist stable, idempotent order/attempt mapping including account, amount, currency, mode and provider ID; protect client key and API keys. Browser success, URL return and polling never mint licenses. Verify PayMongo-Signature against raw request body, timestamp and environment; durably dedupe events, check amount/currency/account/provider identity, reconcile uncertain calls and out-of-order events and execute existing serializable settlement/entitlement/licensing exactly once. Refunds/revocation, gifts, complimentary purchases, customer-authorized renewals and native status must not regress. No automatic rebilling/subscriptions without separate owner-approved consent and business rules.
6. **Checkout experience:** BKE DIGITAL SOLUTIONS identity on first-party product/payment selection, QR, secure card form shell, progress, expiration/retry, confirmation/receipt and licensed access. Show accurate method availability and explicit failure states; responsive desktop/mobile, keyboard accessible. No faux/placeholder QR or false success. Provide actual browser screenshots for review.
7. **Recovery/rollback:** stop creation of new Payment Intents independently of receiving existing paid/refund webhooks. Preserve in-flight attempt settlement even if UI feature flag is disabled. Document partial provider failure, provider timeout after create, retry after idempotency window, support reconciliation and switchback without duplicate charges/rights.

## Certification and proof contract

Minimum complete exact-head CI graph must be declared against the actual diff and existing certification plan; likely affected Payments/Commerce/Entitlements/Licensing, application/authorization, PostgreSQL migration/smoke, TypeScript/lint/build, Workers-compatible bundling and Docker contracts, repository security and required production dependency audit. Confirm actual graph rather than inventing module names.

Must prove with adversarial tests:
- unauthorized/wrong-account/wrong-role checkout; invalid server price/quantity/currency/mode; unsupported merchant method;
- client_key and secret/API material never leak to URL, logs, unauthorized callers or artifacts; raw card data not handled by BKE server;
- duplicate click/two tabs/concurrent retries; provider timeout and ambiguous intent creation; expiration and late paid webhook; repeated, reordered, invalid signature, replayed and conflicting webhooks;
- zero license issuance on browser-only return; exactly one entitlement/license on verified settlement; refunds correctly revoke or adjust rights; gifts/renewals/native status unchanged;
- happy and failure paths in PayMongo **test mode** for QR and each implemented eligible method; card 3DS/decline and wallet authorization when supported;
- real desktop/mobile UI capture, QR rendering, acceptance of the right consent/legal version, proper BKE branding and no PayMongo hosted checkout;
- Workers and Docker receiving compatibility for the eventually integrated exact source. Clearly separate sandbox/provider evidence from live mode and production acceptance.

Every failure checkpoint: 1-2 line first causal failure summary, run link, exact source/workflow SHA, next corrective action. PR comments are durable execution ledger; PR body stays human-readable.

## Authority / explicit exclusions

- FORGE is sole writer to this dedicated PayMongo PR; checkpoint #269 as frozen. No concurrent writes to SOL #266/#267 or #273/#274 and no surprise shared-library writes.
- No merge, self-approval, deploy, production payment or refund, live provider key use, merchant activation, business-name falsification, tax/fee/price mutation, secrets in chat/PR/logs, billing-plan change, or real live transaction without separate explicit authorization.
- Do not import V1 customers; do not refactor Google auth, BKE customer MFA, deleted Supply Chain modules, or Prisma retirement in this PR. Raise precise integration dependencies.
- No production unlock. Protected staging/sandbox actions only within existing authorization and security boundaries; prefer local/CI fixtures first.
- #269 certified security upgrades must be incorporated in the eventual integration candidate and exact-head recertified, but are not a license to rewrite #269 now.

## Required FORGE first checkpoint

Post a PR comment: BKE EXECUTION CHECKPOINT — DISCOVERY; exact PR/source/base SHAs; actual code owners/call-sites; shared library contract conflict; minimal full-vertical QR work plan; method capability and legal/branding constraints; required CI graph; blockages (if any). Then implement in this PR and complete source and sandbox certification. Do not merge.

## Official provider reference

https://docs.paymongo.com/docs/payment-acceptance-introduction
https://docs.paymongo.com/docs/payment-acceptance-key-concepts
https://docs.paymongo.com/docs/payment-acceptance-qr-ph-api
https://docs.paymongo.com/docs/payment-acceptance-e-wallets
https://docs.paymongo.com/docs/account-settings-account-capabilities
https://docs.paymongo.com/docs/payment-acceptance-best-practices
https://docs.paymongo.com/docs/payment-acceptance-go-live-checklist

# PayMongo sandbox verification

For the pre-VPS run, also follow [local production simulation](local-production-simulation.md), [temporary tunnel setup](cloudflare-tunnel-paymongo.md), and the [certification checklist](local-provider-certification-checklist.md). Local simulation accepts only `sk_test_` credentials with `PAYMONGO_LIVEMODE=false`; genuine webhook certification requires exact provider-delivered raw bytes and signatures.

This procedure must use PayMongo test mode only. Never place keys in source code, shell history, test output, screenshots, or committed fixtures.

## Configure

Inject these values through a local ignored `.env` or the development server's secret manager:

```dotenv
PAYMENT_PROVIDER=paymongo
PAYMONGO_SECRET_KEY=sk_test_...
PAYMONGO_WEBHOOK_SECRET=...
PAYMONGO_LIVEMODE=false
```

The sandbox suite refuses `sk_live_…`, missing webhook credentials, live mode, or the mock provider. Keep `PAYMENT_PROVIDER=mock` in normal local and CI jobs.

For provider-event and reconciliation evidence, optionally set:

```dotenv
PAYMONGO_SANDBOX_WEBHOOK_PAYLOAD_FILE=/restricted/temporary/path/event-body.json
PAYMONGO_SANDBOX_WEBHOOK_SIGNATURE_FILE=/restricted/temporary/path/signature.txt
PAYMONGO_SANDBOX_PAYMENT_ID=pay_...
PAYMONGO_SANDBOX_ORDER_ID=<local-order-id>
```

The payload must be the exact unmodified request bytes and the signature file must contain only the exact `Paymongo-Signature` header. Store these in a restricted temporary directory outside the repository, redact them from support material, and delete them after verification. The application itself stores only the provider event ID, event type, mode, processing state, and SHA-256 payload hash.

## Execute

1. Expose the HTTPS development webhook endpoint through an approved authenticated tunnel or development server.
2. Register one PayMongo test webhook at `/api/webhooks/payments` for checkout/payment success, failure, and refund events available to the account.
3. Run `npm run certification:test:paymongo`. It explicitly loads ignored `.env.certification`; confirm real checkout creation executes without logging its URL, keys, or customer data.

The canonical public test webhook route is `https://jl-bke.com/api/webhooks/payments`. Register only this endpoint in PayMongo.
4. Complete PayMongo's test checkout using provider-supplied sandbox payment details; never use a real card or wallet.
5. Confirm the received event has `livemode=false`, the order becomes paid only after the signed webhook, one invoice and one license are created, and identical delivery remains a no-op.
6. Exercise a provider-declined test payment and confirm no entitlement is created.
7. Exercise a test refund when the sandbox account supports it; confirm payment/order refund state, void invoice, revoked license, and cancelled subscription.
8. Retry a previously created event after a delay. A fresh valid delivery signature may carry an old event creation time; a stale signature timestamp must still be rejected.
9. Set the sandbox payment/order IDs and run `npm run payments:reconcile -- <order-id>`. Exit code 0 and `matched:true` are required.
10. Restore `PAYMENT_PROVIDER=mock`, remove temporary event material, and retain only redacted test evidence.

## Required pass evidence

- Real checkout session created in test mode.
- Real signed paid, failed, and refunded events processed.
- Duplicate and delayed delivery behavior confirmed.
- Amount, currency, reference, and mode mismatches rejected.
- Exactly-once payment, invoice, subscription, and license effects confirmed in PostgreSQL.
- Reconciliation matches the PayMongo payment resource.
- Application/server/test logs contain no secret, Authorization header, raw payment payload, license key, or customer billing record.

Until every item above executes without skips or is explicitly recorded as a provider-interactive limitation with deterministic coverage, PayMongo remains a public-payment blocker.

## Current Phase 6.2 result — August 4, 2026

Genuine Test Mode checkout, signed paid settlement, provider retrieval, persisted reconciliation, full-refund creation, signed refund settlement, and transactional access revocation have passed. Deterministic integration coverage passes for failed payments, duplicate/conflicting replay, delayed event occurrence, out-of-order/late settlement, duplicate refund, mismatch rejection, and idempotent effects.

Still requiring owner interaction: a genuine failed hosted checkout and PayMongo Dashboard resends proving duplicate, delayed, and out-of-order provider delivery. The optional exact-raw-payload tests remain skipped because raw payload and signature fixtures are intentionally not retained. See the [Phase 6.2 report](phase-reports/phase-6.2-paymongo-lifecycle-certification.md).
# Database credential source

The immediate QR Ph test flow requests `payment_method_types: ["qrph"]`, matching the currently exposed merchant capability. This is a test-mode compatibility setting only; the permanent design should resolve and validate supported methods from provider capabilities/configuration rather than hardcoding a method set.

PayMongo sandbox credentials can be saved under the TEST context and resolved by the existing adapter through the centralized provider service. Local simulation rejects live keys and live configuration. Credential validation authenticates a safe read request; it does not replace signed webhook and complete sandbox lifecycle certification.
